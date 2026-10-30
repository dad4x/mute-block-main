# Browser Upgrade Regression

> **Status: ROADMAP** (24 Oct 2026). Browser upgrade regression plan (10 Jun). The regression tool exists; no live run is recorded in the plan. Not scheduled. Check planning.md before acting on it. Register: [notes register](docs/notes-register.md).

## Goal

Validate the fresh Chrome profile that started from Chrome Web Store Mute Block
`1.4.186` and was manually upgraded to the keyed current unpacked build with
the same extension ID:

```text
nlmmkoljofpgbmlcojebolmniineboah
```

This suite is browser-backed and CDP-only. It must not add or depend on legacy
progress import, repair aliases, or compatibility migrations.

## Operator Intervention

Automation must stop and print an explicit operator prompt whenever the next
step needs visible browser UI or user credentials. The prompt must be present
in Codex output and in the JSON report as `operatorIntervention`, and every
prompt must begin with this exact prefix:

Known intervention prompts:

The manual Load unpacked prompt is expected when Chrome has not registered the
keyed current build under `nlmmkoljofpgbmlcojebolmniineboah`. Do not work
around that by running the suite against a different local extension ID. The
Quora login prompt is expected only when a content/discovery phase reaches a
login wall. Do not store credentials or add compatibility behavior to bypass
either intervention.

Do not use the `chrome://extensions` Update button to advance a keyed local
unpacked build. Because the local artifact uses the same ID as the Chrome Web
Store extension, Update can fetch or activate the latest store version rather
than the newer local unpacked build. For local validation, explicitly use
Developer mode -> `Load unpacked` again, select the current unpacked build
directory, and verify the listed ID, version, location, and path before running
the suite.

## Phase 1 Non-Work-Starting Smoke

Run against an already-launched Chrome profile with remote debugging exposed on
`127.0.0.1:9223`:

For shell-level CDP health checks, always bypass proxy configuration:

```bash
timeout 10 curl --noproxy '*' -sS http://127.0.0.1:9223/json/version
```

Plain `curl` can time out through proxy settings even when Windows Chrome is healthy. The repo CDP runners use direct Node `http`
requests and do not need the curl flag.

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

### Phase 5 Launch Requirements

Phase 5 is only valid against the keyed current Chrome build registered under
the Chrome Web Store extension ID:

```text
nlmmkoljofpgbmlcojebolmniineboah
```

Do not run Phase 5 against a local unpacked ID such as
`gjjabgpgjpampikjhjpfhneeoapjbjaf`; that tests a separate extension identity,
not the store-upgrade path.

Use a load-only extension launch:

```text
--load-extension="C:\Users\DBROWER\Documents\src\mute-block-main\chrome-unpacked-current"
```

Do not use `--disable-extensions-except` for this upgrade regression profile.
In the managed Chrome environment that flag hid the normal extension registry
and made Web Store installs report that installation was not allowed. The
load-only launch keeps managed/default extensions visible and allows the
extension registry to behave normally.

Command-line `--load-extension` may not register the unpacked build by itself.
If the keyed extension is absent from `chrome://extensions` or CDP does not
show a service worker under
`chrome-extension://nlmmkoljofpgbmlcojebolmniineboah/`, stop and prompt the
operator:

After manual load, the expected extension registry facts are:

- name: `Mute Block`
- id: `nlmmkoljofpgbmlcojebolmniineboah`
- version: the current repo build
- location: `UNPACKED`
- state: `ENABLED`
- zero manifest/runtime/install warnings or errors

Do not use the `chrome://extensions` Update button as a local reload step for
this keyed build. It can update against the Chrome Web Store package for the
same ID instead of loading the current unpacked repo artifact. Use `Load
unpacked` explicitly for each new local build, then confirm the local path and
version.

Only proceed when `/json/list` shows a live extension page or service worker
for the keyed ID. If Chrome loads the unpacked build under any other ID, stop;
the artifact/key assumption is wrong and the suite must not be weakened to pass.

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

## Phase 6 Stale-Content Refresh/Reinject Smoke

Phase 6 remains non-work-starting. It proves that an upgraded extension can
recover a benign Quora content page after reload, and can explicitly reinject
the packaged content script if the current marker or scoped state is stale.

```bash
node tools/cdp/upgrade-regression/run.js \
  --extension-id nlmmkoljofpgbmlcojebolmniineboah \
  --profile-label store-1.4-to-current-warmed-phase6 \
  --phase phase6-stale-content-refresh-reinject-smoke \
  --quora-url https://www.quora.com/
```

The runner opens or reuses a benign Quora page, reloads it, verifies the
content-script ready marker and `get-content-page-coordinator-state`, and
injects `css/content.css` plus `js/content.js` only if the post-refresh state
is not usable. It must finish with scoped current content state.

Allowed side effects are limited to current compact diagnostic/content
projection keys already allowed by Phase 2. Forbidden side effects are the
same authority boundary used by discovery phases: no coordinator queue rows,
no queue view rows, no WAL changes, no profile progress rows, no pending/nuked
space post records, no queued action-surface records, no full legacy
`mbProfileNukeProgress` key, no legacy runtime actions, and no repair/import
alarms.

If the page reaches a Quora login wall, the runner must report the standard
operator prompt:

## Phase 7 Discovery Reload Stability Smoke

Phase 7 remains non-work-starting. It proves logged-in discovery surfaces are
stable across reload after candidate discovery has already run.

```bash
node tools/cdp/upgrade-regression/run.js \
  --extension-id nlmmkoljofpgbmlcojebolmniineboah \
  --profile-label store-1.4-to-current-warmed-phase7 \
  --phase phase7-discovery-reload-stability-smoke
```

The runner opens or reuses the default profile search page and seeded
asset/target space pages, verifies candidate discovery and scoped content
state, reloads each page, and verifies the extension-built candidate/control
surface returns. The profile-search check still requires actionable extension
candidate rows/buttons or a nonzero extension batch candidate count; raw Quora
profile links alone are not enough.

For space pages, Phase 7 uses the same default seeded space registry inputs as
Phase 3. Persisted `mbSpaceRegistry` classification is acceptable. Queue
authority, profile authority/progress, WAL writes, pending/nuked space posts,
queued action-surface records, the full legacy `mbProfileNukeProgress` key,
legacy runtime actions, and repair/import alarms remain forbidden.

## Authenticated Checkpoint 2026-06-04

The meaningful non-work-starting browser upgrade suite completed against the
visible logged-in Windows profile with the keyed unpacked Chrome build:

- extension id: `nlmmkoljofpgbmlcojebolmniineboah`
- extension version: `1.6.854`
- extension location: `UNPACKED`
- manifest/runtime/install warnings and errors: zero

Baseline Phase 6 report:

```bash
node tools/cdp/upgrade-regression/run.js \
  --extension-id nlmmkoljofpgbmlcojebolmniineboah \
  --profile-label session1-loadonly-manual-loaded-phase6-authenticated-20260604 \
  --phase phase6-stale-content-refresh-reinject-smoke \
  --quora-url https://www.quora.com/ \
  --write-baseline tmp/upgrade-regression/session1-loadonly-manual-loaded-phase6-authenticated-20260604.phase6-stale-content-refresh-reinject-smoke.json
```

Result: pass. The authenticated Quora page returned scoped current content
state, no operator intervention was needed, and queue/progress rows remained
zero.

Authenticated profile-search discovery:

```bash
node tools/cdp/upgrade-regression/run.js \
  --extension-id nlmmkoljofpgbmlcojebolmniineboah \
  --profile-label session1-loadonly-manual-loaded-phase3-search-authenticated-20260604 \
  --phase phase3-search-discovery-smoke
```

Result: pass. The default Elon search produced `6` extension candidate rows,
`2` actionable buttons, and batch candidate count `2`. Raw Quora links alone
were not the pass condition. Queue rows, profile progress rows, WAL keys, and
queued action-surface records stayed zero.

Authenticated seeded space discovery:

```bash
node tools/cdp/upgrade-regression/run.js \
  --extension-id nlmmkoljofpgbmlcojebolmniineboah \
  --profile-label session1-loadonly-manual-loaded-phase3-space-authenticated-20260604 \
  --phase phase3-space-discovery-smoke
```

Result: pass. The seeded asset/target spaces produced `99` visible/countable
candidates across four spaces, all scoped states returned zero queue/progress
rows, and no WAL or legacy progress state appeared.

Optional authenticated Phase 4 space-mark UI:

```bash
node tools/cdp/upgrade-regression/run.js \
  --extension-id nlmmkoljofpgbmlcojebolmniineboah \
  --profile-label session1-loadonly-manual-loaded-phase4-space-mark-authenticated-20260604 \
  --phase phase4-space-mark-ui-smoke \
  --space-mark-url https://instantblock.quora.com/ \
  --space-mark-category asset
```

Result: pass. The UI changed the space category from `asset` to temporary
`neutral`, then back to `asset`, and `asset` persisted after reload. The only
intended persistent mutation was `mbSpaceRegistry`; queue/progress/WAL
authority stayed empty.

Authenticated Phase 7 discovery reload stability:

```bash
node tools/cdp/upgrade-regression/run.js \
  --extension-id nlmmkoljofpgbmlcojebolmniineboah \
  --profile-label session1-loadonly-manual-loaded-phase7-discovery-reload-authenticated-20260604 \
  --phase phase7-discovery-reload-stability-smoke
```

Result: pass. Search candidates stayed at `6` after reload with `6` rows, `2`
buttons, and batch candidate count `2`. All four seeded spaces still had
visible/countable candidates after reload. Queue rows, profile progress rows,
WAL keys, pending/nuked space post records, queued action-surface records, the
full legacy `mbProfileNukeProgress` key, legacy runtime actions, and
repair/import alarms stayed absent.

## Queue-Authority Phases

Queue-authority phases are a separate class of regression test. One controlled
item and small-batch tests intentionally create queue authority and profile
state, so they should run only in a disposable profile. Do not run them as the
immediate next step while validating the non-work-starting suite.

Those later phases must still preserve the architecture boundary: WAL-backed
queue authority only, no legacy full-progress storage, no legacy import, and no
repair-style compatibility behavior.

## Phase 8 One-Item Queue Authority Smoke

Phase 8 is the first work-producing browser upgrade test. It must run only in a
disposable logged-in profile copied from the authenticated non-work-starting
profile, or in a fresh logged-in profile. Do not run it against the main
working profile.

The phase is gated so it cannot run accidentally:

```bash
node tools/cdp/upgrade-regression/run.js \
  --extension-id nlmmkoljofpgbmlcojebolmniineboah \
  --profile-label disposable-phase8-one-item \
  --phase phase8-one-item-queue-authority-smoke \
  --search-url 'https://www.quora.com/search?q=elon%20musk&type=profile' \
  --phase8-target-profile-href https://www.quora.com/profile/example \
  --phase8-timeout-ms 120000 \
  --allow-work-producing
```

If `--phase8-target-profile-href` is omitted, the runner clicks the first
enabled profile-search row button. Supplying an already-blocked, harmless, or
throwaway profile URL is preferred.

Phase 8 behavior:

- Opens or reuses the profile-search page and verifies actionable extension
  candidate controls.
- Pauses coordinator work before queueing so the post-enqueue checkpoint can
  inspect durable queued authority before Start.
- Queues exactly one profile through the real profile-search row UI button.
- Asserts one durable queue row, one compact queue view row, and queue WAL
  records.
- Restarts the service worker before Start, wakes it through current diagnostic
  actions, and verifies the queued row hydrates from authority.
- Resumes the paused coordinator and calls the user-equivalent Start path:
  `resume-coordinator-queue` with `userInitiated: true`.
- Waits for one terminal row with bounded timeout.
- Restarts the service worker after terminal, wakes it, and verifies terminal
  state hydrates without reopening work.

Accepted terminal outcomes are succeeded, skipped, canceled, or cancelled. A
failed terminal is treated as a Phase 8 failure because this smoke is intended
to prove the smallest happy or already-settled queue authority path.

Hard stops:

- extension ID is not `nlmmkoljofpgbmlcojebolmniineboah`
- queue authority is non-empty before the one-item enqueue
- full legacy `mbProfileNukeProgress` appears
- legacy repair/import alarm appears
- no queue WAL records appear after enqueue
- compact queue view does not agree with the durable queue row count
- active/queued state remains after the terminal timeout
- queued action-surface records remain after terminal or after terminal hydrate
- terminal hydrate reopens work after service-worker restart

## Phase 9 Small Batch Queue Authority Smoke

Phase 9 is the bounded small-batch work-producing smoke. It should still run in
a disposable logged-in profile. For the current upgrade investigation, the
operator explicitly allowed using the warmed current profile, so Phase 9 scopes
its assertions to the selected targets and forbids unrelated active/queued
growth instead of requiring globally empty terminal history.

```bash
node tools/cdp/upgrade-regression/run.js \
  --extension-id nlmmkoljofpgbmlcojebolmniineboah \
  --profile-label disposable-phase9-small-batch \
  --phase phase9-small-batch-queue-authority-smoke \
  --search-url 'https://www.quora.com/search?q=tim%20cook&type=profile' \
  --phase9-target-count 3 \
  --phase9-timeout-ms 600000 \
  --allow-work-producing
```

Phase 9 behavior:

- Opens or reuses the profile-search page and verifies actionable extension
  candidate controls.
- Selects 3 to 5 enabled profile-search row buttons and records the exact
  normalized profile URLs before clicking.
- Temporarily sets `profilesPerBatch` to 1 before opening/reloading the search
  page so the profile-search UI enqueues low-concurrency rows, then restores
  the prior value before the report is finalized.
- Pauses coordinator work before queueing.
- Queues each selected target through its real row UI button.
- Asserts every selected target has one durable queue authority row, one compact
  queue view row, and queue WAL records before Start.
- Restarts the service worker before Start and verifies the selected queued rows
  hydrate from WAL/current authority.
- Resumes the paused coordinator and calls the user-equivalent Start path once:
  `resume-coordinator-queue` with `userInitiated: true`.
- Waits for all selected targets to reach terminal state with a bounded timeout.
- Restarts the service worker after terminal and verifies terminal rows hydrate
  without reopening selected or unrelated work.

Accepted terminal outcomes are succeeded, skipped, canceled, or cancelled. The
runner tracks rows by normalized profile URL and fails on any selected row that
remains active/opening/acting after the timeout. It also fails if any
active/queued row is visible outside the selected target set.

Hard stops:

- extension ID is not `nlmmkoljofpgbmlcojebolmniineboah`
- fewer than the requested number of enabled profile-search row buttons exist
- any selected row is missing durable queue authority or compact queue view
- service-worker restart loses queued or terminal selected rows
- full legacy `mbProfileNukeProgress` appears
- legacy repair/import alarm appears
- no queue WAL records appear after enqueue
- queued action-surface records remain after terminal or after terminal hydrate
- unrelated active/queued rows appear outside the selected target set

Live status on 2026-06-05: Phase 9 is validated in `v1.6.865` against the keyed
upgrade profile after queue-authority processing fixes and harness tightening.
The passing warmed-profile baseline used:

```bash
node tools/cdp/upgrade-regression/run.js \
  --extension-id nlmmkoljofpgbmlcojebolmniineboah \
  --host 127.0.0.1 \
  --port 9223 \
  --profile-label current-profile-phase9-865-barack \
  --phase phase9-small-batch-queue-authority-smoke \
  --allow-work-producing \
  --search-url 'https://www.quora.com/search?q=barack%20obama&type=profile' \
  --phase9-target-count 3 \
  --include-flight-recorder \
  --write-baseline tmp/upgrade-regression/current-profile-phase9-865-barack.json
```

Known residue: raw `mbCoordinatorQueue` may diverge from WAL/recovered
authority in warmed profiles. That mirror is reported but not used as
authority. Recovered queue authority, compact queue view, executor state, and
runtime/accounting checks are the current authority surfaces.

## Phase 10 Medium Batch Queue Authority Smoke

Phase 10 is the next work-producing regression after the Phase 9 checkpoint. It
uses the same real profile-search UI enqueue path, but selects 8 to 12 fresh
candidates that are not already present in recovered queue authority. It is
still for a disposable or explicitly approved warmed logged-in profile.

```bash
node tools/cdp/upgrade-regression/run.js \
  --extension-id nlmmkoljofpgbmlcojebolmniineboah \
  --profile-label disposable-phase10-medium-batch \
  --phase phase10-medium-batch-queue-authority-smoke \
  --search-url 'https://www.quora.com/search?q=barack%20obama&type=profile' \
  --phase10-target-count 10 \
  --phase10-concurrency 2 \
  --phase10-timeout-ms 1200000 \
  --phase10-idle-ms 20000 \
  --allow-work-producing
```

Phase 10 behavior:

- Opens or reuses the profile-search page and verifies actionable extension
  candidate controls.
- Excludes all candidates already present in recovered/current queue authority.
- Temporarily sets `profilesPerBatch` to the requested low concurrency, default
  2, then restores the prior value before the report is finalized.
- Queues selected targets through real row UI buttons.
- Verifies durable queue authority, compact queue view, and WAL before Start.
- Restarts the service worker before Start and after terminal.
- Starts once through `resume-coordinator-queue` with `userInitiated: true`.
- Requires all selected rows to end terminal with 0 selected active/queued rows.
- Requires no queued action-surface records after terminal/hydrate.
- Waits the configured idle interval after completion and includes the
  flight-recorder delta in the report. Any idle recorder entry is a failure.

Phase 10 explicitly reports raw mirror divergence but does not treat raw
`mbCoordinatorQueue` as authority unless that stale state leaks into recovered
authority, compact view, executor behavior, or runtime accounting.
