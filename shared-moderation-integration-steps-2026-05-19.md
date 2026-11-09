# Shared Moderation Integration Steps, 2026-05-19

> **Status: ROADMAP** (24 Oct 2026). Staged integration steps (19 May). Runtime integration deferred. Not scheduled. Check planning.md before acting on it. Register: [notes register](docs/notes-register.md).

Status: supporting staged plan, runtime integration deferred.

Canonical planning now starts at [planning.md](planning.md). Canonical
architecture starts at [architecture.md](architecture.md). Keep this as the
step-by-step shared-moderation lane; overall ordering belongs in `planning.md`.

This note is the step-by-step integration plan for shared moderation while the
runtime debug cycle is still active elsewhere. It is intentionally a planning
artifact only: no shipped source files, manifests, package versions, generated
build outputs, or extension zips are part of this lane.

## Current Status

Status: still mostly deferred for runtime source, with mock harness groundwork
now green.

Done:

- Step 0 baseline has been validated previously, and the mock HTTP smoke was
  re-run during this cleanup pass with `node tools/mock-quora/smoke.js`;
- Step 1 fixture metadata is now present on mock Space pages:
  `mute-block-mock-quora`, `mute-block-space-url`, and
  `mute-block-space-slug`;
- Step 1 smoke coverage now asserts the metadata contract in
  `tools/mock-quora/smoke.js`, and the Firefox BiDi mock smoke reads the same
  metadata;
- Step 2 has implementation support: the temporary extension copy and Firefox
  install helpers exist;
- Step 2 local browser path was revalidated with
  `timeout 90 tools/firefox-bidi/run-mock-smoke.sh`, including MBLOCK
  extraction and metadata from `/space/shared-blocks`;
- static shared-moderation fixtures now exist under
  `test/fixtures/shared-moderation/` for future pure model tests;
- Step 4 has a pure, unwired foundation in `shared/js/sharedModeration.js` with
  direct fixture-backed tests in `test/sharedModeration.test.js` and
  deterministic fuzz coverage in `test/sharedModerationFuzz.test.js`. This is
  not wired into `npm test` yet to avoid editing the active package script
  lane;
- `tools/mock-quora/validate-shared-moderation-fixtures.js` validates the
  shared-moderation fixture corpus without package-test wiring;
- `tools/firefox-bidi/extract-mblock.js` now reuses the pure MBLOCK parser
  instead of carrying a duplicate parser.

Still open:

- Step 3 is recorded as metadata-gated mock support through the temporary
  localhost manifest, not broad production localhost behavior;
- Step 4 still needs package-test wiring and review before it is considered
  integrated;
- Steps 5 through 13 remain deferred until source ownership is clear.

## Safe Prep Checklist

- [x] Revalidate mock HTTP and Firefox BiDi smokes.
- [x] Add explicit mock Space metadata and smoke assertions.
- [x] Add shared moderation fixture corpus.
- [x] Add pure shared moderation model and direct tests.
- [x] Add hostile fixtures for malformed MBLOCK, duplicate events, wrong schema
  versions, missing publisher, URL-rewritten subjects, and forbidden roaming
  profile fields.
- [x] Add deterministic pure fuzz coverage.
- [x] Add standalone fixture validator.
- [x] Make Firefox MBLOCK extraction reuse the pure parser.
- [x] Record the mock recognition decision.
- [ ] Wire pure shared moderation tests into `npm test` after package-script
  ownership is clear.
- [ ] Begin Step 5 only after runtime source ownership is clear.

## Safe Follow-Up Checklist, 2026-05-20

These items stay inside the safe lane: docs, fixtures, mock harnesses, and the
unwired pure shared-moderation module.

- [x] Re-run direct fixture/model tests.
- [x] Re-run mock HTTP and Firefox BiDi smokes.
- [x] Re-run the current package test script without adding new package wiring.
- [x] Add `MBLOCK` parser coverage for Quora-rendered blank-line and spacing
  variants.
- [x] Add a pure local label-policy resolver for imported moderation labels,
  covering `ignore`, `warn`, `queue`, `mute`, `block`, and `mute_block`
  actions without executing any action.
- [x] Add fixture-validator summary counts for expected-valid and
  expected-invalid corpus shape.
- [x] Replace filename-derived fixture expectations with
  `test/fixtures/shared-moderation/fixture-manifest.json`, and make the
  validator assert manifest coverage.
- [x] Add a pure import inbox contract: external profile events become review
  inputs, self journals are ignored for action, duplicate imports are
  idempotent, and dismiss/apply cannot start queued work.
- [x] Add a pure Space recommendation apply contract: imported Space
  classifications stay in a recommendation inbox, and acceptance creates a
  local classification event payload before any future registry write.
- [x] Add parser fixtures for extra paragraphs between MBLOCK documents,
  JSON-looking text outside MBLOCK markers, and truncated end markers.
- [x] Write
  `shared-moderation-runtime-boundary-handoff-2026-05-20.md` for the future
  runtime integration boundary.
- [ ] Keep package-test wiring deferred until package-script ownership is
  clear.
- [ ] Keep runtime integration deferred until source ownership is clear.

Validation run for this checklist:

- `node tools/mock-quora/validate-shared-moderation-fixtures.js`: green, 18
  fixtures checked through an explicit manifest, 11 expected-valid and 7
  expected-invalid.
- `node test/sharedModeration.test.js`: green.
- `node test/sharedModerationFuzz.test.js`: green.
- `node tools/mock-quora/smoke.js`: green.
- `timeout 90 tools/firefox-bidi/run-mock-smoke.sh`: green.
- `npm test`: green on the current package script. The new shared moderation
  tests are still intentionally direct-only until package-script ownership is
  clear.

Related notes:

- `shared-moderation-publication-design-2026-05-18.md`
- `shared-moderation-publication-implementation-plan-2026-05-18.md`
- `firefox-mock-harness-integration-plan-2026-05-19.md`

## Standing Boundary

Until the active debug cycle is done, this lane owns documentation,
mock-harness files under `tools/`, shared-moderation fixtures, and the
unwired pure `shared/js/sharedModeration.js` model plus direct tests. Runtime
integration remains out of scope.

Do not touch these files in this lane:

- `shared/js/content.js`
- `shared/js/sw.js`
- `shared/js/spaceRegistry.js`
- `shared/js/subject.js`
- `manifests/chrome.json`
- `manifests/firefox.json`
- `package.json`
- `package-lock.json`
- generated `chrome/`, `firefox/`, or zip artifacts

Do not run release builds in this lane:

- `npm run prod`
- `npm run build:chrome`
- `npm run build:firefox`

Allowed while the debug cycle continues:

- refine `tools/mock-quora/`
- refine `tools/firefox-bidi/`
- refine `test/fixtures/shared-moderation/`
- refine the pure, unwired `shared/js/sharedModeration.js` model and
  `test/sharedModeration.test.js`
- run local mock-only smoke tests with the dedicated Firefox profile
- create temporary extension copies under `/tmp`
- write or update planning notes

## Integration Rule

Each step should produce one of three outcomes:

- `green`: the step's validation passed and the next step can start;
- `blocked`: a real decision, missing hook, or failing validation stops the
  lane;
- `deferred`: the step requires ownership of source files currently being
  debugged by the other Codex.

Do not merge two source-owning steps into one patch. The point of this plan is
to keep review and rollback boundaries small.

## Step 0: Preserve The Current Baseline

Purpose: make sure we know what already works before adding integration hooks.

Owned files:

- planning notes only
- existing mock harness files if needed

Validation:

```bash
bash -lc 'node tools/mock-quora/smoke.js'
bash -lc 'timeout 90 tools/firefox-bidi/run-mock-smoke.sh'
```

Acceptance:

- mock HTTP smoke exits `0`;
- Firefox mock smoke exits `0`;
- mock shared-blocks page exposes one parseable `MBLOCK` document;
- mock composer proof contains the expected title and document id;
- no production source, manifest, package, or generated artifact changes.

Status now: validated earlier in the harness lane. Re-run only if the harness
is edited or before handing the lane to another implementer.

## Step 1: Harden Mock Fixtures Without Source Hooks

Purpose: make the mock pages carry the metadata future source hooks will need,
without changing extension runtime behavior.

Owned files:

- `tools/mock-quora/server.js`
- `tools/mock-quora/smoke.js`
- optional new `tools/firefox-bidi/` smoke helper
- `tools/mock-quora/README.md`

Fixture metadata contract:

```html
<meta name="mute-block-mock-quora" content="space">
<meta name="mute-block-space-url" content="https://muteblockdevelopment.quora.com/">
<meta name="mute-block-space-slug" content="muteblockdevelopment">
```

Work:

- add fixture metadata to mock Space pages;
- add a smoke assertion that reads those fields from the browser;
- keep mock pages explicit about their intended real Quora Space URL;
- keep the extension uninvolved at this step.

Acceptance:

- existing mock smokes still pass;
- metadata smoke proves the canonical Space URL and slug are visible;
- no `shared/js/*` or manifest edits.

Why this step matters: it lets later content-script integration use a narrow
page-marker gate instead of guessing that every localhost page is Quora-like.

## Step 2: Prove Temporary Extension Install Mechanics

Purpose: make sure the dedicated Firefox path can install a localhost-enabled
temporary extension copy before the source code tries to use it.

Owned files:

- `tools/mock-quora/make-dev-firefox-extension.js`
- `tools/firefox-bidi/install-extension.js`
- optional wrapper smoke under `tools/firefox-bidi/`

Work:

- create `/tmp/mute-block-firefox-mock` from the built Firefox extension;
- patch only the temporary manifest copy for `http://127.0.0.1:*/*`;
- install that temporary extension into the dedicated Firefox profile;
- attach again after install to prove the browser remains controllable.

Acceptance:

- production manifests remain Quora-only;
- install returns extension data from BiDi;
- `target-summary.js` still attaches after install;
- no source or package edits.

This step is still harness-only. It proves the lane can later test real
extension behavior on mock pages without requiring live Quora.

## Step 3: Decide The Mock Recognition Gate

Purpose: pick the narrow rule source code will use when the debug cycle is
clear.

Recommended decision:

- use explicit page metadata plus localhost-only injection from the temporary
  dev manifest;
- keep pure parser/model tests independent of browser fixtures;
- do not add broad production localhost behavior.

Decision record to confirm before source edits:

- mock page support is metadata-gated;
- production manifests do not inject on localhost;
- the temporary dev manifest is the only localhost injection path;
- source checks for mock metadata only on `http://127.0.0.1:*`.

Decision status: recorded. The source implementation should accept mock pages
only when both conditions hold:

1. The page URL is localhost from the temporary dev manifest path.
2. The page exposes the explicit `mute-block-mock-quora` metadata expected for
   the page type.

Do not add production localhost host permissions, production localhost content
script matches, or a broad "localhost means Quora" branch.

Acceptance:

- the rule can be stated in one paragraph in the implementation review;
- no build-time secret constant is needed unless the source code already has a
  clean dev-constant mechanism.

## Step 4: Pure Model Foundation

Purpose: add transport-neutral shared-moderation logic that can be tested
without Quora, Firefox, Chrome, service-worker lifetime, or dashboard state.

Status: pure foundation present, runtime integration deferred.

Owned files:

- new `shared/js/sharedModeration.js`
- new or updated `test/sharedModeration.test.js`
- `test/fixtures/shared-moderation/`
- package test wiring remains intentionally deferred

Work:

- render and parse `MBLOCK:BEGIN v=1` / `MBLOCK:END` documents;
- validate event journal and roaming profile schemas;
- normalize duplicate-tolerant event journals;
- implement export threshold decisions;
- implement posted-proof reducer;
- implement source relationship helper: `self`, `external`, `unknown`;
- implement recommendation aggregation and dismissal helpers;
- reject browser-specific fields from roaming profiles.

Acceptance:

- pure tests pass without browser automation using
  `node test/sharedModeration.test.js`;
- no service-worker or content-script integration yet;
- posted-proof logic exists before any exporter can mark events exported.

Collision risk: low if the other Codex is not editing new model/test files.

## Step 5: Space Registry Mode Upgrade

Purpose: migrate Space classification data from simple category to
category-plus-mode while preserving existing behavior.

Deferred until source ownership is available.

Owned files when active:

- `shared/js/spaceRegistry.js`
- targeted tests

Work:

- add modes `manual`, `reviewed`, and `dead-hand`;
- map old `asset` records to `asset/manual`;
- map old `target` records to `target/manual`;
- keep neutral records mode-free;
- preserve current asset/target scanning semantics.

Acceptance:

- existing registry data loads without loss;
- neutral clears stale mode;
- tests prove legacy upgrade behavior.

Collision risk: medium. Coordinate with any active debug work touching Space
records or queue eligibility.

## Step 6: Single Dropdown Classification UI

Purpose: replace the three peer category buttons with the single-control model.

Deferred until source ownership is available.

Owned files when active:

- `shared/js/content.js`
- `shared/js/popup.js`
- `shared/css/content.css`
- `shared/css/popup.css`
- targeted UI helper tests if available

State model:

- neutral/unset shows `Mute-Block Category`: `Asset`, `Neutral`, `Target`;
- asset shows `Mute-Block Asset`: `Manual`, `Reviewed`, `Dead Hand`,
  `Neutral`;
- target shows `Mute-Block Target`: `Manual`, `Reviewed`, `Dead Hand`,
  `Neutral`;
- selecting neutral clears mode.

Acceptance:

- only one classification dropdown is visible at a time;
- the path back to neutral is explicit;
- current asset/target behavior remains correct after the UI change;
- recommendation indicator is a placeholder hook only until import exists.

Collision risk: high if another Codex is debugging content-page behavior.
Do not start this step until ownership is clear.

## Step 7: Local Mutation Outbox

Purpose: record only changes this browser profile actually made to Quora or to
local Space classification state.

Deferred until source ownership is available.

Owned files when active:

- `shared/js/sharedModeration.js`
- `shared/js/sw.js`
- `shared/js/content.js` only if result messages need fields
- tests for outbox idempotence

Record:

- successful block;
- successful unblock;
- successful mute;
- successful unmute;
- local Space classification change.

Do not record:

- already-blocked or already-muted observations;
- failed attempts;
- candidates merely discovered;
- imported recommendations before local acceptance;
- queue bookkeeping.

Acceptance:

- duplicate terminal reports cannot duplicate events;
- stale attempts cannot create events;
- local profile id is provenance, not a machine id;
- local profile id is never included in a public roaming profile.

Collision risk: high because service-worker settlement logic is actively
debugged often. This step should be isolated and reviewed carefully.

## Step 8: Scheduler Without Composer Automation

Purpose: introduce export orchestration before any real Quora posting is
attempted.

Deferred until source ownership is available.

Owned files when active:

- `shared/js/sw.js`
- `shared/js/coordinator.js`
- `shared/coordinator.html`
- `shared/css/coordinator.css`
- `shared/js/sharedModeration.js`
- scheduler tests or static contracts

Work:

- daily alarm path;
- export lease with expiry;
- pending event selection;
- automatic minimum threshold, default around 10;
- manual `Publish Now` that overrides threshold;
- status states including skipped-low-volume, attempting, failed,
  proof-missing, and exported.

Acceptance:

- service worker owns scheduling;
- Dashboard only commands and displays status;
- failed automatic export leaves events pending until tomorrow or manual push;
- no event is marked exported without posted proof.

Collision risk: high. This step touches `sw.js`; take it only after the active
debug lane is clear.

## Step 9: Mock Composer Worker

Purpose: exercise export mechanics locally through the same reducer and proof
rules intended for real Quora, while still avoiding live Quora.

Deferred until source ownership is available, but depends on Steps 1 and 2.

Owned files when active:

- `shared/js/sw.js`
- `shared/js/content.js`
- `shared/js/sharedModeration.js`
- `tools/mock-quora/`
- `tools/firefox-bidi/`

Work:

- allow a dev-profile setting to target the mock composer;
- open the mock composer through the service-worker export path;
- fill visible text plus `MBLOCK` JSON;
- re-read the rendered mock post;
- verify expected document id and event ids.

Acceptance:

- successful mock proof marks only verified events exported;
- failed mock post leaves events pending;
- posted-proof reducer is shared with the later live exporter;
- production host permissions remain unchanged.

Collision risk: high because this is the first browser-runtime integration.

## Step 10: Import Parser And Recommendation Inbox

Purpose: turn shared posts into local moderation inputs and manually reviewed
Space classification recommendations.

Deferred until source ownership is available.

Owned files when active:

- `shared/js/sharedModeration.js`
- `shared/js/sw.js`
- `shared/js/coordinator.js`
- `shared/coordinator.html`
- `shared/css/coordinator.css`
- `shared/js/content.js` for the dropdown indicator
- tests for source relationship and recommendation reducers

Work:

- parse `MBLOCK` documents from subscribed/trusted/shared Spaces;
- preserve source post URL, document id, event id, publisher, timestamps, and
  provenance;
- classify source as self, external, or unknown;
- store external Space classifications as recommendations only;
- add Dashboard/Preferences review UI;
- make the classification dropdown indicator open the focused review view.

Acceptance:

- external Space classifications never auto-apply;
- applying writes local registry and records a local classification event;
- dismissing records a tombstone;
- repeated import does not resurrect dismissed recommendations unless policy
  explicitly changes.

## Step 11: Roaming Profile And Pointer

Purpose: support same-account, multi-browser configuration sharing without
publishing browser-specific identifiers.

Deferred until source ownership is available.

Owned files when active:

- `shared/js/sharedModeration.js`
- `shared/js/sw.js`
- Dashboard/Preferences UI files
- tests for sanitizer and pointer/profile parsing

Work:

- `Use Roaming Profile` setting per local browser profile;
- browser-agnostic roaming profile schema;
- current-profile pointer parser;
- profile publication path;
- pinned pointer update path;
- profile import path.

Acceptance:

- roaming profile includes as many browser-agnostic settings as make sense;
- sanitizer rejects local profile id, browser labels, machine names, queue
  state, leases, retry history, and UI-local details;
- a browser can import once and later turn off roaming profile.

## Step 12: Live Quora Gate

Purpose: prove the real site still accepts and renders the workflow. This is
not a local mock responsibility.

Preconditions:

- pure tests pass;
- local mock Firefox smoke passes;
- active debug cycle is clear;
- user explicitly wants a live post or live validation;
- use direct CDP, not Puppeteer.

Live target:

- controlled test Space such as `https://muteblockexperimental.quora.com/`

Acceptance:

- a real post is created only when explicitly requested;
- Quora-rendered post remains parseable;
- proof finds expected document id and event ids;
- failure leaves events pending;
- selector/timing failures report `needs-user` or `failed`, not success.

## Step 13: Release Build Gate

Purpose: package only after source behavior is intentionally ready to ship.

Precondition:

- version bump first in `package.json`, `package-lock.json`,
  `manifests/chrome.json`, and `manifests/firefox.json`.

Validation:

- syntax checks over changed JavaScript;
- `npm test`;
- `npm run prod`;
- Chrome and Firefox package builds;
- generated zip artifacts verified;
- live CDP smoke if the release includes Quora composer/import behavior.

Acceptance:

- packaged artifacts match the bumped version;
- no release build was run at the old version.

## Ownership Hand-Off Checklist

Before starting a source-owning step, write down:

- exact files owned by the step;
- files the other Codex is currently touching;
- tests to run before and after;
- expected user-visible behavior change;
- rollback boundary if the step fails.

If ownership is unclear, stay in documentation and `tools/`.

## Recommended Near-Term Sequence

While the other Codex is still debugging:

1. Keep the existing pure/model/mock work green with direct tests.
2. Stop before Step 5 unless source ownership becomes available.
3. Do not wire package scripts, runtime source, manifests, or release builds
   from this lane while the other refactor is active.

When the debug cycle clears:

1. Wire `test/sharedModeration.test.js` and
   `test/sharedModerationFuzz.test.js` into the package test script.
2. Step 5: registry mode upgrade.
3. Step 6: single dropdown UI.
4. Step 7: mutation outbox.
5. Step 8: scheduler without composer automation.
6. Step 9: mock composer worker.
7. Step 10: import and recommendations.
8. Step 11: roaming profile.
9. Step 12: live Quora gate.
10. Step 13: release build gate.
