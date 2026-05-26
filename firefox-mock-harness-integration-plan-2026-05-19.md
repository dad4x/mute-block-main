# Firefox Mock Harness Integration Plan, 2026-05-19

Status: active supporting harness plan.

Canonical planning now starts at [planning.md](planning.md). Canonical
architecture starts at [architecture.md](architecture.md). This note remains the
mock-harness integration detail, not the overall project plan.

This plan describes how to integrate the new local Firefox/mock-Quora harness
without disturbing the active live-debug cycle in the main extension runtime.

## Current Status

Status: partially implemented.

Done:

- harness directories exist under `tools/mock-quora/` and
  `tools/firefox-bidi/`;
- mock HTTP smoke is currently green as of this cleanup pass:
  `bash -lc 'node tools/mock-quora/smoke.js'`;
- `make-dev-firefox-extension.js` and `install-extension.js` exist, so the
  temporary-extension mechanics have implementation support;
- the mock harness can render and parse `MBLOCK` proof content.

Still open:

- mock fixture metadata (`mute-block-mock-quora`,
  `mute-block-space-url`, `mute-block-space-slug`) is not present in
  `tools/mock-quora/` yet;
- the temporary Firefox extension install path should be revalidated before it
  is treated as green in a new work session;
- no production source hook should be added until ownership is clear.

Current constraint: another Codex is working in the runtime/debug lane. Until
that work settles, this lane should avoid edits to `shared/js/*`, production
manifests, package versions, generated extension outputs, and build artifacts.

## Current Harness State

Harness-only files now exist under:

- `tools/mock-quora/`
- `tools/firefox-bidi/`

Validated local commands:

```bash
bash -lc 'node tools/mock-quora/smoke.js'
bash -lc 'timeout 90 tools/firefox-bidi/run-mock-smoke.sh'
```

The full smoke currently proves:

- localhost mock Quora server starts;
- dedicated Firefox profile starts on BiDi;
- BiDi session attaches and ends cleanly;
- mock Space page is visible;
- mock shared-blocks page renders one parseable `MBLOCK` document;
- mock composer can be driven through Firefox and posted proof is visible;
- `extract-mblock.js` can parse rendered `MBLOCK` blocks from page text.

The harness deliberately does not prove:

- real Quora login;
- Cloudflare behavior;
- real Quora composer selectors;
- real Quora post acceptance or rewriting;
- extension source behavior on the mock pages.

## Non-Disturbance Rules

Until the active debug cycle is done:

- do not edit `shared/js/content.js`;
- do not edit `shared/js/sw.js`;
- do not edit `shared/js/spaceRegistry.js`;
- do not edit `shared/js/subject.js`;
- do not edit `manifests/chrome.json` or `manifests/firefox.json`;
- do not run `npm run prod`, `npm run build:chrome`, or `npm run build:firefox`;
- do not regenerate zips;
- do not attach to the remote/live Quora Chrome path;
- do not use the real logged-in Quora Firefox profile.

Allowed in this lane:

- add or refine harness scripts under `tools/firefox-bidi/`;
- add or refine fixtures under `tools/mock-quora/`;
- add documentation and planning notes;
- run mock-only smoke checks against a dedicated Firefox profile;
- create temporary extension copies under `/tmp`.

## Step 1: Keep Harness Baseline Green

Purpose: preserve a known-good local-only browser smoke before any extension
source integration.

Run:

```bash
bash -lc 'node tools/mock-quora/smoke.js'
bash -lc 'timeout 90 tools/firefox-bidi/run-mock-smoke.sh'
```

Acceptance:

- both commands exit `0`;
- no mock server or dedicated Firefox process remains after the run;
- `run-mock-smoke.sh` output includes:
  - `counts.mock-quora-space: 1`;
  - `shared.hasMblock: true`;
  - document id `mbj:mock:2026-05-18:001`;
  - event types `profile.block.add` and `space.classification.set`;
  - posted proof saw title and document id.

No product source changes are part of this step.

## Step 2: Temporary Dev Extension Copy

Purpose: prepare a localhost-enabled extension directory without changing
production manifests or package files.

Run:

```bash
bash -lc 'node tools/mock-quora/make-dev-firefox-extension.js'
```

Default output:

```text
/tmp/mute-block-firefox-mock
```

The temporary manifest should add only:

- `http://127.0.0.1:*/*` to content-script matches;
- `http://127.0.0.1:*/*` to host permissions;
- `http://127.0.0.1:*/*` to web-accessible resource matches.

Acceptance:

- production `firefox/manifest.json` is unchanged;
- production `manifests/firefox.json` is unchanged;
- temporary manifest has localhost permissions;
- temporary manifest keeps the current extension version for traceability.

No product source changes are part of this step.

## Step 3: Install Temporary Extension Into Dedicated Firefox

Purpose: prove Firefox BiDi can install the temporary localhost-enabled
extension into the dedicated profile.

Preconditions:

```bash
bash -lc 'node tools/mock-quora/server.js'
bash -lc 'tools/firefox-bidi/launch-dedicated-firefox.sh http://127.0.0.1:8765/'
```

Then:

```bash
bash -lc 'node tools/mock-quora/make-dev-firefox-extension.js'
bash -lc 'node tools/firefox-bidi/install-extension.js --path /tmp/mute-block-firefox-mock'
```

Acceptance:

- BiDi returns extension install data;
- `session.end` runs cleanly;
- subsequent `target-summary.js` still attaches;
- no production source or manifest changes occur.

This step proves installation mechanics only. It does not yet require the
extension to recognize mock pages as Quora-like.

## Step 4: Decide The Mock-Page Recognition Boundary

This is the first real design decision before touching product source.

Problem: current runtime code correctly assumes real Quora hosts. Examples:

- `shared/js/spaceRegistry.js` normalizes `*.quora.com` Space URLs.
- `shared/js/subject.js` rejects non-Quora profile hosts.
- `shared/js/content.js` detects Space pages from Quora subdomain roots.
- `shared/js/sw.js` filters tab and action URLs to Quora hosts.

Do not solve this by broadly treating all localhost pages as Quora in
production code.

Candidate approaches:

1. Build-time dev constant:
   - temporary dev output defines a constant like `MB_ENABLE_MOCK_QUORA`;
   - source checks that constant before accepting mock hosts;
   - production builds keep it false or absent.

2. Explicit page marker plus dev manifest:
   - mock pages expose a marker such as
     `<meta name="mute-block-mock-quora" content="space">`;
   - source accepts marker only on localhost and only when dev mode is enabled;
   - production manifest never injects on localhost, so marker is inert in
     shipped builds.

3. Test-only adapter module:
   - extract URL and Space classification logic into pure helpers;
   - tests call helpers with mock origins;
   - content script itself remains Quora-only until live integration.

Recommendation:

Use option 3 first for pure logic and option 2 for browser harness work. Avoid
option 1 unless the build pipeline already has a clean dev-constant mechanism.

Decision needed before source edits:

- Should mock-page support be page-marker based, build-constant based, or kept
  pure-test-only for now?

## Step 5: Pure Adapter Extraction Before Browser Runtime Wiring

Purpose: get value from the mock path without making content-script runtime
behavior depend on localhost.

Candidate files after the active debug cycle is safe to touch:

- `shared/js/spaceRegistry.js`
- `shared/js/subject.js`
- new `test/mockQuoraAdapter.test.js` or similar

Work:

- add pure helpers that classify:
  - real Quora Space URL;
  - real Quora profile URL;
  - mock Space URL with explicit fixture metadata;
  - mock profile URL with explicit fixture metadata;
- keep default behavior Quora-only;
- add tests for both real and mock cases.

Acceptance:

- production URL normalization remains unchanged for existing Quora cases;
- mock handling is reachable only through explicit helper inputs or explicit
  mock metadata;
- `npm test` passes.

This step can be done before touching content-page UI injection.

## Step 6: Content-Script Mock Injection Gate

Purpose: allow the content script to run enough behavior on mock Space pages to
test UI state and shared-post parsing.

Candidate source ownership after active debug cycle:

- `shared/js/content.js`
- possibly `shared/js/spaceRegistry.js`
- tests/static contracts if available

Fixture contract:

Mock Space pages should include stable metadata:

```html
<meta name="mute-block-mock-quora" content="space">
<meta name="mute-block-space-url" content="https://muteblockdevelopment.quora.com/">
<meta name="mute-block-space-slug" content="muteblockdevelopment">
```

Runtime gate:

- content script may accept mock metadata only on `http://127.0.0.1:*`;
- production manifest still does not inject on localhost;
- dev-only temporary manifest injects on localhost;
- no behavior changes on real Quora hosts.

Acceptance:

- local mock Space shows extension classification controls from the content
  script, not only fixture buttons;
- existing real Quora detection behavior is unchanged by tests/static checks;
- mock smoke can verify extension-owned selectors appear.

## Step 7: Import Parser Integration

Purpose: connect rendered mock shared-blocks posts to the eventual import
parser.

Source ownership after active debug cycle:

- likely `shared/js/sharedModeration.js` once created;
- tests under `test/`;
- optional harness script under `tools/firefox-bidi/`.

Work:

- keep rendered-block extraction pure:
  - input: page text or DOM root;
  - output: parsed `MBLOCK` documents with validation errors;
- unit-test whitespace, blank lines, multiple blocks, invalid JSON, wrong
  schema, duplicate event ids;
- browser-smoke the same parser against `/space/shared-blocks`.

Acceptance:

- parser unit tests pass without browser;
- `extract-mblock.js` proves rendered text shape is still parseable in Firefox;
- no import actions are queued from browser smoke yet.

## Step 8: Mock Composer Export Worker

Purpose: develop export-worker mechanics locally before testing real Quora
composer automation.

Source ownership after active debug cycle:

- `shared/js/sw.js`
- `shared/js/content.js`
- `shared/js/sharedModeration.js`
- harness under `tools/firefox-bidi/`

Work:

- add an export target abstraction:
  - real Quora Space target;
  - mock composer target;
- mock target must be enabled only by dev profile/settings and localhost
  manifest;
- service worker opens mock composer;
- content/page worker fills visible text plus `MBLOCK`;
- proof verification re-reads rendered post and confirms document/event ids.

Acceptance:

- failed mock post leaves events pending;
- successful mock post marks only verified events exported;
- posted-proof reducer is shared with later real Quora export;
- no production host permissions are broadened.

## Step 9: Recommendation Review Integration

Purpose: use mock shared-blocks as input for recommendation-review UI before
live import from real Spaces.

Source ownership after active debug cycle:

- `shared/js/sharedModeration.js`
- `shared/js/coordinator.js`
- `shared/coordinator.html`
- `shared/css/coordinator.css`
- possibly `shared/js/content.js` for Space-page indicator

Work:

- parse external `space.classification.set` from mock shared-blocks;
- store as recommendation, not local registry mutation;
- show recommendation in Dashboard/Preferences;
- mock Space page indicator opens focused recommendation view.

Acceptance:

- imported Space classifications do not auto-apply;
- Apply writes local Space registry;
- Dismiss records a local tombstone;
- repeated import does not resurrect dismissed recommendation unless policy
  says it should.

## Step 10: Live Quora Smoke Remains A Separate Gate

The mock harness is not a release proof for Quora itself.

Only after source work passes local pure tests and mock Firefox smoke should
the live path be tested, and only when it will not disturb the active debug
cycle:

- remote/live Chrome CDP for Quora;
- controlled test Space such as `muteblockexperimental.quora.com`;
- real composer selectors and timing;
- Quora rendering/rewrite behavior.

Acceptance for live gate:

- real post is created only when explicitly requested;
- posted entry is visible and parseable;
- event ids are not marked exported until proof succeeds;
- failure leaves events pending.

## Proposed Immediate Next Steps

While the other Codex continues runtime debugging:

1. Keep this lane limited to docs and `tools/`.
2. Done: add the basic mock/Firefox harness and mock HTTP smoke.
3. Done enough to revalidate: add temporary-extension copy/install scripts.
4. Next: add mock fixture metadata described in Step 6.
5. Next: add a harness smoke that verifies fixture metadata and canonical intended
   Quora URLs without loading the extension.
6. Revalidate the temporary extension install smoke before source hooks depend
   on it.
7. Stop before source hooks until the active debug cycle is clear or the user
   explicitly assigns source ownership.

## Decision Points

Decision 1:

Should mock-page recognition eventually be page-marker based, build-constant
based, or pure-test-only?

Decision 2:

Should the temporary dev extension copy be the only way to inject on localhost,
or should there be a committed dev manifest/config?

Decision 3:

When the active debug cycle ends, which source slice gets ownership first:
pure parser/model extraction, content-script mock Space detection, or export
worker mock composer flow?
