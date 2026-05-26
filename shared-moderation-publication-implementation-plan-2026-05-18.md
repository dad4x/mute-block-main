# Shared Moderation Publication Implementation And Test Plan, 2026-05-18

Status: supporting implementation plan, runtime integration deferred.

Canonical planning now starts at [planning.md](planning.md). Canonical
architecture starts at [architecture.md](architecture.md). Use this for the
Quora shared-post MVP details after queue/runtime stabilization gates are met.

Source design note:
[shared-moderation-publication-design-2026-05-18.md](shared-moderation-publication-design-2026-05-18.md)

This plan covers the Quora shared-post MVP. ATproto server/labeler work remains
deferred, except that schemas should stay transport-neutral enough to project
there later.

## Scope

Implement:

- single Space classification dropdown with `Asset`, `Neutral`, `Target`, then
  category-specific `Manual`, `Reviewed`, `Dead Hand`, `Neutral`;
- Space registry records with `category` and `mode`;
- local storage profile id for local event provenance;
- mutation-only event journal;
- transparent Quora shared-post serialization and parsing;
- daily service-worker export scheduling with minimum batch threshold;
- manual Dashboard `Publish Now`;
- export confirmation before marking events exported;
- roaming profile opt-in and pinned pointer model;
- import parsing into local moderation inputs and Space classification
  recommendations;
- Dashboard/Preferences review UI for Space recommendations;
- classification-dropdown indicator that opens the recommendation view for the
  current Space.

Do not implement:

- ATproto DID, labeler, or server integration;
- global shared index;
- direct Quora API posting outside the normal Quora page/composer path;
- auto-application of external Space classification recommendations;
- publication of already-blocked/already-muted observations;
- Puppeteer-based validation.

## Implementation Slices

### 0. Baseline And Build Discipline

- Preserve unrelated dirty work.
- Before shipped source behavior changes are rebuilt, bump version in:
  - `package.json`
  - `package-lock.json`
  - `manifests/chrome.json`
  - `manifests/firefox.json`
- Keep docs-only plan edits separate from shipped source changes.
- Use direct CDP for live browser validation; never Puppeteer.

Acceptance:

- Baseline `npm test` is known before behavior work begins.
- Version bump happens before any release-oriented build/package step.

### 1. Pure Shared-Moderation Model Module

Add a pure CommonJS module, likely `shared/js/sharedModeration.js`, for logic
that can be tested without live Quora:

- event type constants:
  - `profile.block.add`
  - `profile.block.remove`
  - `profile.mute.add`
  - `profile.mute.remove`
  - `space.classification.set`
- schema constants:
  - `com.muteblock.eventJournal`
  - roaming profile schema name/version;
- `MBLOCK:BEGIN v=1` / `MBLOCK:END` render and parse helpers;
- JSON schema validation helpers for event journals and roaming profiles;
- duplicate-tolerant event normalization;
- export batch decision helper:
  - automatic export requires pending events >= preference threshold;
  - manual export can override threshold;
- export state reducer:
  - pending -> attempting;
  - attempting -> exported only after posted proof;
  - attempting -> pending on failure;
- source relationship helper:
  - `self`
  - `external`
  - `unknown`;
- Space recommendation reducer:
  - pending recommendations aggregate by Space and suggested classification;
  - dismissed recommendations do not reappear;
  - accepted recommendations produce local registry writes;
- roaming profile sanitizer that rejects browser-specific fields.

Acceptance:

- The module has no DOM, browser, storage, or network dependencies.
- Unit tests cover serialization, validation, scheduling decisions, posted
  proof, duplicate tolerance, source relationship, recommendation reduction,
  and roaming-profile sanitization.

### 2. Space Registry Mode Upgrade

Update `shared/js/spaceRegistry.js`:

- add mode constants:
  - `manual`
  - `reviewed`
  - `dead-hand`;
- keep `category` as `asset`, `neutral`, `target`, or empty;
- add `normalizeSpaceMode(category, mode)`;
- extend `buildSpaceRecord()` to accept mode;
- map legacy records:
  - old `asset` -> `asset/manual`;
  - old `target` -> `target/manual`;
  - old `neutral` -> `neutral` with empty mode;
- update sort and labels so category/mode are stable and displayable.

Acceptance:

- Existing records load without data loss.
- Neutral records do not retain stale asset/target modes.
- Tests prove legacy upgrade behavior.

### 3. Single Dropdown Space Classification UI

Update content-page controls and popup/management controls.

Content page:

- replace the three peer category buttons with one dropdown;
- neutral/unset Space shows `Mute-Block Category`:
  - `Asset`
  - `Neutral`
  - `Target`
- asset Space shows `Mute-Block Asset`:
  - `Manual`
  - `Reviewed`
  - `Dead Hand`
  - `Neutral`
- target Space shows `Mute-Block Target`:
  - `Manual`
  - `Reviewed`
  - `Dead Hand`
  - `Neutral`
- selecting `Asset` or `Target` from neutral defaults to `manual`;
- selecting `Neutral` clears mode;
- when recommendations exist for the current Space, show a compact indicator
  on or next to the dropdown;
- activating the indicator opens an extension tab focused on recommendations
  for that Space.

Popup/management UI:

- show current category/mode;
- allow changing classification with the same state model;
- avoid presenting `Neutral` as an accidental peer button beside active modes.

Acceptance:

- One visible Space classification control exists at a time.
- There is always an explicit path back to neutral.
- Recommendation indicator does not apply changes inline.

### 4. Local Storage Profile Identity

Add local storage profile identity:

- generated once per extension local storage profile;
- not a machine id;
- not included in the public roaming profile;
- included in event journals as source-instance provenance;
- optional local-only editable label for debugging.

Acceptance:

- Existing installs get an id lazily.
- Clearing extension local storage creates a new id.
- Roaming profile sanitizer rejects source instance ids and labels.

### 5. Mutation Event Recording

Record only actual local mutations:

- successful block -> `profile.block.add`;
- successful unblock -> `profile.block.remove`;
- successful mute -> `profile.mute.add`;
- successful unmute -> `profile.mute.remove`;
- local Space classification change -> `space.classification.set`.

Do not record:

- already-blocked / already-muted observations;
- failed attempts;
- candidates merely discovered;
- queue state;
- imported recommendations before local acceptance.

Implementation guidance:

- Prefer recording profile mutation events at the service-worker terminal
  settlement boundary where the action kind, outcome, attempt id, source, and
  queue row are visible.
- Ensure retries and stale terminal reports cannot duplicate events for the
  same successful attempt.
- Record Space classification events when local user action changes the
  registry from content page, popup, or recommendation acceptance.

Acceptance:

- Successful mute/block/unmute/unblock events enter a pending export outbox.
- Already-done outcomes do not enter the outbox.
- Duplicate terminal reports do not create duplicate mutation events.

### 6. Export Scheduler And Service-Worker Orchestration

Add service-worker-owned scheduling:

- daily alarm for export;
- storage-backed next due / last started / last completed / last result;
- export lease with expiry;
- pending-event selection;
- minimum automatic export threshold preference, initially around 10;
- manual `Publish Now` command from Dashboard that overrides the threshold;
- no immediate retry loop after automatic failure.

Export flow:

1. Service worker wakes on alarm or manual request.
2. Service worker selects pending events.
3. If automatic and below threshold, record `skipped-low-volume`.
4. Service worker builds a journal document.
5. Service worker opens or reuses a Quora shared Space export worker tab.
6. Content script posts through the normal Quora composer.
7. Content script or service worker re-reads the resulting post.
8. Posted proof must include expected `document_id` and event ids.
9. Only then mark those event ids exported.
10. On failure, release the lease and leave events pending for tomorrow or
    manual retry.

Acceptance:

- Dashboard is not required for scheduled export.
- Dashboard manual button calls the same service-worker path.
- Events are never marked exported without posted proof.
- Failure leaves events pending and does not spin.

### 7. Quora Composer Export Worker

Implement the smallest Quora page worker needed for MVP:

- open configured shared export Space;
- create a human-readable post with `MBLOCK` JSON appendix;
- report clear terminal states:
  - `posted`;
  - `needs-user`;
  - `failed`;
- return post URL and extractable posted block for verification.

Keep this behind explicit settings while stabilizing:

- export enabled;
- export Space URL;
- minimum batch threshold;
- manual publish available.

Acceptance:

- If the composer cannot be driven safely, the attempt fails without marking
  events exported.
- If Quora mangles the JSON block, verification fails.
- The worker does not depend on Dashboard being open.

### 8. Roaming Profile And Pinned Pointer

Implement same-account roaming configuration:

- per-local-profile `Use Roaming Profile` option;
- browser-agnostic roaming profile schema;
- pinned pointer post format:
  - `Current Mute-Block roaming profile: <url>`;
- profile import path that reads the current pointer and then reads the current
  profile document;
- profile publication path that posts a new profile document and updates the
  pinned pointer.

Roaming profile may include:

- Space category/mode;
- shared export Space URL;
- daily export enabled/disabled;
- minimum automatic export batch threshold;
- subscribed/shared source Space list;
- same-account import cadence;
- browser-agnostic Manual/Reviewed/Dead Hand defaults.

Roaming profile must not include:

- source instance id;
- browser/profile label;
- machine/device/browser names;
- queue state;
- execution history;
- leases/retry state;
- local UI layout preferences.

Acceptance:

- A fresh local profile can opt in and import shared browser-agnostic config.
- A local profile can opt out after importing.
- Sanitizer rejects forbidden browser-specific fields before publication.

### 9. Import And Recommendation Inbox

Implement Quora shared-post import:

- scan configured subscribed/trusted/shared Spaces;
- parse `MBLOCK` blocks;
- validate event journal and roaming profile schemas;
- classify source as `self`, `external`, or `unknown`;
- store imported profile mutation events as moderation inputs;
- store external `space.classification.set` as recommendations only;
- aggregate duplicate recommendations;
- preserve source post URL, document id, event id, publisher, timestamps, and
  provenance.

Space recommendation UI:

- Dashboard or Preferences `Space Recommendations` view;
- row fields:
  - Space name/URL;
  - current local classification;
  - recommended category/mode;
  - source publisher and source post URL;
  - source count;
  - first seen / last seen;
  - `Apply`, `Dismiss`, `Open Space`;
- applying writes local Space registry and records a local
  `space.classification.set` event;
- dismissing records a local tombstone.

Acceptance:

- External classification recommendations never auto-apply.
- Self profile action events are audit only.
- External profile action events become moderation inputs subject to local
  policy.
- Unknown-source imports stay conservative.

### 10. Dashboard Status And Controls

Add Dashboard/Preferences controls:

- shared export enabled;
- export Space URL;
- minimum auto-export threshold;
- `Publish Now`;
- last export status;
- pending export event count;
- last posted document/post URL;
- `Import Now`;
- `Rebuild From Shared Spaces`;
- `Show Last Scan`;
- Space Recommendations view;
- roaming profile opt-in and current pointer/profile status.

Acceptance:

- Manual controls report service-worker results honestly.
- Status distinguishes skipped-low-volume, failed, needs-user, and posted.

## Test Plan

### Unit Tests

Add focused Node tests, likely `test/sharedModeration.test.js`, and include it
in `npm test`.

Cover:

- marker rendering and parsing;
- Quora-added blank-line tolerance;
- malformed/missing marker rejection;
- event journal schema validation;
- roaming profile schema validation;
- forbidden roaming-profile field rejection;
- event type validation;
- duplicate event id tolerance;
- automatic export threshold suppression;
- manual export threshold override;
- export reducer does not mark exported without posted proof;
- export failure leaves events pending;
- self/external/unknown source relationship;
- external classification import becomes recommendation;
- self classification import becomes roaming config;
- self profile mutation import is audit-only;
- dismissed recommendation tombstones suppress repeats;
- accepted recommendation produces a registry update request.

### Space Registry Tests

Add or extend tests for:

- old `asset` records upgrade to `asset/manual`;
- old `target` records upgrade to `target/manual`;
- neutral clears mode;
- invalid mode is ignored or normalized;
- labels for category/mode are stable;
- sort remains deterministic.

### Static Contract Tests

Extend `test/p1-contract.test.js` only where useful, not as a substitute for
pure tests.

Candidate contracts:

- content Space classification control no longer renders three peer buttons;
- service worker has an export alarm path;
- Dashboard `Publish Now` sends a service-worker request rather than owning
  export logic;
- exported event marking depends on posted proof helper;
- content page recommendation indicator opens an extension tab instead of
  applying inline.

### Storage/Reducer Harness Tests

Use pure fake-storage harnesses for:

- export lease acquire/release/expiry;
- automatic failure leaves pending events;
- retry next day is allowed;
- manual retry is allowed immediately;
- service-worker startup/alarm due check;
- local mutation outbox append idempotence by attempt/action event id.

### Content/UI Tests

Keep most UI behavior in pure helpers where possible.

Test:

- dropdown option set for neutral/unset;
- dropdown option set for asset;
- dropdown option set for target;
- transitions:
  - neutral -> asset/manual;
  - neutral -> target/manual;
  - asset/reviewed -> neutral;
  - target/dead-hand -> neutral;
- recommendation indicator visibility decision;
- recommendation target URL for opening the extension tab.

If DOM-heavy tests become necessary, add a minimal fixture harness rather than
trying to validate Quora's live DOM in unit tests.

### Live CDP Smoke Tests

Use direct Chrome DevTools Protocol only.

Run against a controlled Quora test Space such as
`https://muteblockexperimental.quora.com/`.

Smoke cases:

- posted `MBLOCK` block remains extractable after Quora renders the post;
- raw profile URLs are not required in posted JSON;
- export worker can create a post or fails with `needs-user`/`failed` without
  marking events exported;
- service-worker manual `Publish Now` opens the export worker tab;
- export proof finds expected document id and event ids;
- below-threshold automatic export skips without posting;
- manual publish below threshold posts;
- imported recommendation appears in Dashboard/Preferences;
- visiting the recommended Space shows dropdown recommendation indicator;
- indicator opens the focused recommendation view.

### Local Mock Browser Development

We should not make every browser-facing change depend on the tunneled,
logged-in remote browser. Local mock development can cover most extension
plumbing even when local Quora access is blocked by firewall/proxy/Cloudflare.

Available local baseline:

- `/bin/firefox` exists locally;
- global `web-ext` is not required because the repo uses `npx web-ext`;
- current production manifests inject only on `https://*.quora.com/*`, so mock
  pages need a dev-only manifest or test harness.

Recommended mock setup:

- add `tools/mock-quora/` with static fixture pages for:
  - Space page with classification controls;
  - shared-blocks Space with rendered `MBLOCK` posts;
  - composer/export page that accepts a post body and renders it back;
  - recommendation target Space;
- add a tiny local fixture server, for example under `tools/mock-quora/`, using
  only Node built-ins;
- add a dev-only Firefox config such as `firefox-mock-config.cjs`;
- add a dev-only manifest transform/output that permits localhost fixture
  pages, for example `http://127.0.0.1:*/*`;
- keep production manifests restricted to Quora.

Implementation guardrails:

- mock-host support must be explicitly gated, for example by dev-only manifest
  output and/or a local storage flag;
- do not broaden production `host_permissions` or `content_scripts.matches`;
- avoid making localhost behavior a hidden production feature;
- fixtures should include canonical metadata or explicit test attributes so the
  extension can map local mock pages to Quora-like Space/profile subjects;
- fixture DOM should use Quora-like structure only where the extension actually
  depends on it.

Mock cases worth automating:

- Space dropdown state machine on a mock Space page;
- mode persistence and legacy registry upgrade display;
- recommendation indicator on a mock Space page;
- indicator opens focused recommendation view;
- import parser extracts `MBLOCK` blocks from rendered mock posts;
- external `space.classification.set` becomes a pending recommendation;
- `Publish Now` opens a mock export worker tab;
- export worker writes visible text plus `MBLOCK` JSON to the mock composer;
- posted-proof verification finds expected `document_id` and event ids;
- below-threshold automatic export skips without touching the mock composer;
- failure/needs-user paths leave pending events unexported.

What local mock development cannot prove:

- Quora login/session state;
- Cloudflare behavior;
- real composer selectors and timing;
- whether Quora accepts, rewrites, or suppresses a real post;
- long-running remote Chrome behavior under the user's actual account.

Those still require live CDP checks against a real browser. The mock path is
for faster local development and regression coverage, not release proof that
Quora still accepts the workflow.

### Release Validation

For shipped source changes:

- bump version first;
- run syntax checks over changed JavaScript;
- run `npm test`;
- run `npm run prod`;
- run Chrome and Firefox build/package steps;
- reload the unpacked Chrome build through CDP;
- run the live smoke checks above;
- verify generated Chrome and Firefox zip artifacts exist.

## Suggested Implementation Order

1. Pure model and tests.
2. Space registry category/mode upgrade and tests.
3. Single dropdown UI without import/export.
4. Local storage profile id and mutation outbox.
5. Event journal serializer/parser and tests.
6. Service-worker export scheduler without Quora posting.
7. Dashboard status and manual `Publish Now` wired to scheduler.
8. Quora export worker and posted-proof verification.
9. Import parser and recommendation store.
10. Recommendation review UI and classification dropdown indicator.
11. Roaming profile pointer/profile support.
12. Live CDP smoke and package validation.

This order keeps most risk in pure code first and defers live Quora composer
automation until the event model, scheduler, and confirmation rules are already
testable.

Local mock browser development can start after Package B, and should be in
place before Package E. That lets the export worker and recommendation UI be
developed locally before spending remote-browser time on live Quora selector
and composer behavior.

## Work Packages

These packages are intended to be independently reviewable. Do not start with
the Quora composer automation; get the model, storage, and UI state machine
stable first.

### Package A: Pure Model Foundation

Owned files:

- `shared/js/sharedModeration.js`
- `test/sharedModeration.test.js`
- `package.json` test script

Deliverables:

- event journal render/parse/validate;
- roaming profile render/parse/validate/sanitize;
- export threshold and posted-proof reducers;
- source relationship helper;
- recommendation aggregation helper.

Exit criteria:

- all new pure tests pass;
- no live browser dependency;
- no source-file contract tests needed yet.

### Package B: Space Registry And Classification UI

Owned files:

- `shared/js/spaceRegistry.js`
- `shared/js/content.js`
- `shared/js/popup.js`
- `shared/css/content.css`
- `shared/css/popup.css`
- targeted tests for registry and UI helper behavior

Deliverables:

- category/mode storage upgrade;
- single dropdown state machine;
- back-compat with existing `asset`, `neutral`, `target` records;
- current-space recommendation indicator hook, with placeholder target URL if
  the recommendation page does not exist yet.

Exit criteria:

- existing asset/target page scanning still keys off category correctly;
- neutral clears mode;
- dropdown has one visible classification control at a time;
- `npm test` passes.

### Package C: Local Mutation Outbox

Owned files:

- `shared/js/sharedModeration.js`
- `shared/js/sw.js`
- `shared/js/content.js` only if content-side result reporting needs new fields
- tests for outbox idempotence and event selection

Deliverables:

- local storage profile id creation;
- pending export event outbox;
- mutation event recording for actual successful mute/block/unmute/unblock;
- local Space classification mutation events;
- no events for already-done, failed, discovered-only, or queued-only state.

Exit criteria:

- duplicate terminal reports do not duplicate outbox events;
- stale attempts do not record events;
- accepted recommendation can later reuse the same classification event path.

### Package D: Export Scheduler Without Composer Automation

Owned files:

- `shared/js/sw.js`
- `shared/js/coordinator.js`
- `shared/coordinator.html`
- `shared/css/coordinator.css`
- `shared/js/sharedModeration.js`
- scheduler tests / static contracts

Deliverables:

- daily alarm path;
- export lease;
- automatic threshold suppression;
- manual Dashboard `Publish Now`;
- state transitions for skipped/attempting/failed/post-proof-missing/exported;
- stubbed worker result path that can be unit-tested before live Quora posting.

Exit criteria:

- service worker owns scheduling;
- Dashboard only commands and displays status;
- events are exported only through posted-proof reducer;
- automatic failure leaves events pending and does not retry-loop.

### Package E: Quora Export Worker

Owned files:

- `shared/js/content.js`
- `shared/js/sw.js`
- optional CDP smoke helper under `tools/cdp/`
- optional local mock fixtures under `tools/mock-quora/`
- tests for parser/proof helpers

Deliverables:

- open configured shared export Space;
- compose visible post plus `MBLOCK` JSON appendix;
- return `posted`, `needs-user`, or `failed`;
- verify rendered post contains expected `document_id` and event ids.

Exit criteria:

- failure never marks events exported;
- posted-proof failure leaves events pending;
- live CDP smoke proves a posted block can be re-read from
  `muteblockexperimental.quora.com` or the chosen test Space.

Mock-development exit criteria:

- the same service-worker export path can target the mock composer in a dev
  manifest/profile;
- mock posted-proof verification exercises the same reducer used by live
  export;
- no production manifest permission is broadened for the mock.

### Package F: Import And Recommendation Review

Owned files:

- `shared/js/sharedModeration.js`
- `shared/js/sw.js`
- `shared/js/coordinator.js`
- `shared/coordinator.html`
- `shared/css/coordinator.css`
- `shared/js/content.js` for dropdown indicator/open-tab hook
- tests for recommendation reducers and source relationship

Deliverables:

- scan/import shared Spaces;
- store external classification recommendations separately from registry;
- self imports apply roaming config only when enabled;
- Dashboard/Preferences `Space Recommendations` view;
- `Apply`, `Dismiss`, `Open Space`;
- content dropdown recommendation indicator opens focused extension tab.

Exit criteria:

- external recommendations never auto-apply;
- dismiss tombstones suppress repeat recommendations;
- applying writes local registry and records a local classification mutation.

### Package G: Roaming Profile

Owned files:

- `shared/js/sharedModeration.js`
- `shared/js/sw.js`
- Dashboard/Preferences UI files
- tests for sanitizer and pointer/profile parse

Deliverables:

- `Use Roaming Profile` setting;
- browser-agnostic roaming profile schema;
- current-profile pointer parser;
- publish profile document and update pinned pointer;
- import current profile via pointer.

Exit criteria:

- forbidden browser-specific fields are rejected before publication;
- opt-in profile import works on a fresh local profile;
- turning off roaming profile stops following future shared changes.

## First Coding Pass Recommendation

Start with Package A and Package B only.

Reason:

- they carry the least live-Quora risk;
- they create the data vocabulary every later slice needs;
- they produce meaningful unit tests early;
- they do not require versioned release packaging until source behavior is
  intentionally shipped.

Minimum first-pass deliverable:

- `shared/js/sharedModeration.js`;
- `test/sharedModeration.test.js`;
- `shared/js/spaceRegistry.js` category/mode upgrade;
- tests proving old registry records upgrade correctly;
- no composer automation;
- no scheduled export yet.

Suggested first-pass validation:

- `node test/sharedModeration.test.js`
- existing `npm test` after adding the new test to the script
- `node --check` on changed JavaScript

## Integration Risks

- `shared/js/sw.js` is large and already owns durable queue behavior. Keep the
  export scheduler small and storage-backed; do not entangle it with the
  existing profile-action queue more than needed.
- Space classification is read from content-page scanning paths today. The
  category/mode upgrade must preserve the old `isAssetSpacePage()` and
  `isTargetSpacePage()` behavior until modes are wired in.
- Quora composer automation is the least deterministic part. It must be behind
  explicit settings, produce honest `needs-user`/`failed` outcomes, and never
  mark events exported without posted proof.
- The roaming profile pointer is intentionally mutable, unlike action journals.
  Keep that distinction obvious in code and tests.
- Public Quora posts are transparent for the MVP. Do not add half-private
  behavior that implies privacy the transport cannot provide.

## Definition Of Done For MVP

The MVP is complete when:

- a local browser profile can categorize Spaces with the single dropdown model;
- actual successful local mute/block/unmute/unblock and local Space
  classification changes create pending mutation events;
- daily automatic export skips below threshold and posts at or above threshold;
- manual `Publish Now` can post below threshold;
- events are marked exported only after posted proof is verified;
- a fresh same-account browser profile can opt into the roaming profile and
  import browser-agnostic settings;
- an external subscribed Space can produce profile moderation inputs and Space
  classification recommendations;
- recommendations require manual approval before changing local Space
  classification;
- the current Space dropdown can indicate pending recommendations and open the
  focused recommendation view;
- `npm test`, syntax checks, production build, package builds, and CDP smoke
  validation all pass after the required version bump.
