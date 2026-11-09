# Shared Moderation Test Plan, 2026-05-20

> **Status: ROADMAP** (24 Oct 2026). Pure-model and mock test plan (20 May). The safe lane today. Not scheduled. Check planning.md before acting on it. Register: [notes register](docs/notes-register.md).

Status: active supporting test plan.

Canonical planning now starts at [planning.md](planning.md). Canonical
architecture starts at [architecture.md](architecture.md). Use this for
sharedModeration-specific tests; fold project-wide test priority back into
`planning.md`.

This plan covers testing for `shared/js/sharedModeration.js` and the future
runtime integration around shared moderation posts, imports, recommendations,
exports, and mock/live Quora behavior.

The current safe lane is pure model, fixtures, mock harnesses, and notes. It
does not own runtime integration in `shared/js/sw.js`, `shared/js/content.js`,
`shared/js/spaceRegistry.js`, manifests, package scripts, or release artifacts.

## Test Goals

- Keep imported moderation data as review and policy input, not a remote
  command channel.
- Prove parser, validation, normalization, policy, inbox, recommendation, and
  proof reducers without browser, service-worker, storage, or network
  dependencies.
- Prove mock-browser plumbing before live Quora integration.
- Add runtime tests only when the owning refactor lane is clear.
- Make every later source-owning step have a small rollback boundary and a
  matching test gate.

## Current Direct Test Set

Current direct commands:

```bash
node tools/mock-quora/validate-shared-moderation-fixtures.js
node test/sharedModeration.test.js
node test/sharedModerationFuzz.test.js
```

Current mock/browser commands:

```bash
node tools/mock-quora/smoke.js
timeout 90 tools/firefox-bidi/run-mock-smoke.sh
```

Current package lane:

```bash
npm test
```

Important: `test/sharedModeration.test.js` and
`test/sharedModerationFuzz.test.js` are intentionally direct-only until
package-script ownership is clear.

## Fixture Corpus Contract

Owned files:

- `test/fixtures/shared-moderation/fixture-manifest.json`
- `test/fixtures/shared-moderation/*.json`
- `test/fixtures/shared-moderation/*.txt`
- `tools/mock-quora/validate-shared-moderation-fixtures.js`

The manifest is authoritative. Do not infer expected validity from filenames.
The validator must assert that every fixture is listed exactly once.

Required fixture classes:

- valid event journal;
- duplicate event ids;
- missing publisher;
- wrong schema version;
- URL-rewritten profile subject;
- malformed MBLOCK JSON;
- multiple valid MBLOCK blocks;
- Quora-style whitespace around MBLOCK content;
- prose paragraphs between MBLOCK blocks;
- JSON-looking text outside MBLOCK markers;
- truncated end marker;
- valid roaming profile;
- roaming profile with top-level forbidden fields;
- roaming profile with nested forbidden fields;
- posted proof;
- label policy input;
- profile import inbox input.

Acceptance:

- fixture validator exits `0`;
- reported `checked`, `expectedValid`, and `expectedInvalid` counts match the
  manifest;
- unexpected files fail validation until added to the manifest.

## Pure Model Coverage

Owned files:

- `shared/js/sharedModeration.js`
- `test/sharedModeration.test.js`
- `test/sharedModerationFuzz.test.js`
- `test/fixtures/shared-moderation/`

### Parser

Required assertions:

- parses `MBLOCK:BEGIN v=1` / `MBLOCK:END`;
- reports malformed JSON without throwing;
- parses multiple blocks in one rendered post;
- ignores ordinary prose and JSON-looking text outside markers;
- ignores truncated blocks;
- preserves version number and raw JSON text.

Future useful additions:

- marker text inside code/preformatted blocks;
- repeated `MBLOCK:BEGIN` before the first `MBLOCK:END`;
- very large human prose around a small block;
- non-v1 marker detection, if version negotiation is added.

### Event Journal Validation

Required assertions:

- schema and schema version are enforced;
- `document_id` is required;
- publisher must identify a Quora profile or ATproto DID;
- profile action events require a canonicalizable Quora profile subject;
- Space classification events require a Quora Space URL and valid
  category/mode;
- duplicate event ids normalize idempotently.

Future useful additions:

- deterministic ordering after normalization;
- duplicate event ids with conflicting payloads;
- events with unknown extra fields are either preserved or rejected by an
  explicit policy.

### Roaming Profile Validation

Required assertions:

- valid profile passes;
- browser-local and queue-local fields are rejected anywhere in the object;
- nested arrays are traversed for forbidden fields.

Future useful additions:

- explicit allowlist for settings that may roam;
- maximum profile size;
- pointer/current-profile document validation.

### Local Policy

Required assertions:

- supports `ignore`, `warn`, `queue`, `mute`, `block`, and `mute_block`;
- label-specific policy overrides labeler/source defaults;
- strongest matching action wins when multiple labels apply;
- unknown policy values normalize to safe fallback;
- policy resolution does not execute actions.

Future useful additions:

- per-source "informational only" cap;
- "never auto-block from this labeler" cap;
- conflict reporting when labels imply incompatible actions.

### Import Inbox

Required assertions:

- external profile events become review inputs;
- self journals do not create imported actions;
- unknown-source journals do not create imported actions;
- duplicate imports are idempotent;
- dismiss is idempotent;
- apply is idempotent;
- imported records do not contain queue or executor fields.

Future useful additions:

- stale source post updates;
- withdrawn source events;
- local tombstones preventing dismissed records from resurrecting.

### Space Recommendations

Required assertions:

- external Space classifications become recommendations;
- self and unknown-source journals do not create recommendations;
- recommendations remain separate by publisher and mode;
- dismissal suppresses matching recommendations;
- accepting a recommendation emits a local Space classification event payload;
- accepting a recommendation does not directly write registry state.

Future useful additions:

- aggregation thresholds across several publishers;
- recommendation replacement when the same source changes mode;
- explicit tombstones for dismissed recommendations.

### Export And Proof

Required assertions:

- automatic export obeys minimum threshold;
- manual export can override volume threshold;
- exported status requires posted proof;
- missing event ids fail proof verification;
- failed export returns events to pending state.

Future useful additions:

- stale attempt proof rejection;
- duplicate proof replay;
- partial proof behavior when some event ids are missing.

## Fuzz Coverage

Current fuzz is deterministic and direct:

```bash
node test/sharedModerationFuzz.test.js
```

Current coverage:

- random MBLOCK parse plus event journal normalization;
- random roaming-profile forbidden-field recursion.

Add later:

- import inbox random duplicate/dismiss/apply sequences;
- Space recommendation import/dismiss/apply sequences;
- label policy conflict fuzzing;
- proof reducer sequences where attempts, failures, and proofs arrive in
  adversarial order.

Acceptance:

- no throw;
- reducers return stable boolean/result shapes;
- repeated actions are idempotent where specified;
- invalid remote input never creates executable local work.

## Mock Harness Coverage

Owned files while safe lane is active:

- `tools/mock-quora/`
- `tools/firefox-bidi/`
- `test/fixtures/shared-moderation/`

Required smoke:

```bash
node tools/mock-quora/smoke.js
timeout 90 tools/firefox-bidi/run-mock-smoke.sh
```

Required assertions:

- mock Space pages expose `mute-block-mock-quora`,
  `mute-block-space-url`, and `mute-block-space-slug` metadata;
- `/space/shared-blocks` renders at least one parseable MBLOCK document;
- Firefox BiDi extraction uses `shared/js/sharedModeration.js`, not a duplicate
  parser;
- mock composer proof contains expected title and document id;
- production manifests are not changed for localhost.

Future useful additions:

- mock page with several posts, only some containing MBLOCK blocks;
- mock page where one block is malformed and another is valid;
- mock post whose rendered text has Quora-like link rewriting;
- mock composer failure path that leaves export inputs pending.

## Runtime Integration Tests

Do not start this until ownership of runtime files is clear.

Runtime-owned files are expected to include:

- `shared/js/sw.js`
- `shared/js/content.js`
- `shared/js/spaceRegistry.js`
- `shared/js/coordinator.js`
- dashboard/coordinator HTML and CSS as needed
- package scripts only after ownership is clear

### Parser/Import Runtime Gate

Required tests:

- content script or service worker passes rendered post text into
  `parseMblockBlocks`;
- invalid blocks are reported but do not create inbox records;
- external profile events go to import inbox only;
- external Space events go to recommendation inbox only;
- self journals do not create imported actions;
- unknown-source journals do not create imported actions.

Regression risks to watch:

- duplicate ad hoc parser in runtime code;
- direct queue writes from imported profile events;
- direct registry writes from imported Space events.

### Review UI Gate

Required tests:

- profile import inbox shows pending, dismissed, and applied states;
- Space recommendation inbox shows pending, dismissed, and applied states;
- applying a Space recommendation creates a local classification event payload
  before registry apply;
- dismissing prevents immediate resurrection on re-import;
- UI actions route through service-worker authority, not direct storage
  primitives.

### Queue/Execution Gate

Required tests:

- accepted profile moderation input can queue work only through the established
  service-worker queue entry point;
- local foreground mute/block/close buttons remain the explicit exception for
  visible user-directed profile actions;
- imported remote data cannot bypass review/policy into direct execution.

### Export Scheduler Gate

Required tests:

- threshold skip;
- manual publish override;
- export lease and retry behavior;
- failed proof leaves events pending;
- successful proof marks only verified event ids exported;
- service-worker sleep/restart does not cause duplicate export or false proof.

### Storage Authority Gate

Required tests:

- import inbox, recommendation inbox, local events, and export status persist
  through the storage authority layer;
- no runtime integration writes directly to lower-level storage primitives;
- repair can reconstruct from authoritative state, but normal import does not
  depend on repair.

## Live Quora Gate

Live testing requires explicit user direction.

Preconditions:

- pure tests green;
- mock HTTP smoke green;
- Firefox BiDi mock smoke green;
- runtime integration tests green;
- use direct CDP or approved repo harnesses, not Puppeteer;
- target a controlled test Space.

Required assertions:

- real rendered post remains parseable;
- proof finds expected document id and event ids;
- selector/timing failures report failure, not success;
- failed live export leaves local events pending.

## Package And Release Gate

Do not package shared moderation changes until source behavior is intentionally
ready to ship.

Before any release build:

- bump version in `package.json`, `package-lock.json`,
  `manifests/chrome.json`, and `manifests/firefox.json`;
- wire shared moderation direct tests into `npm test`;
- run syntax and package tests;
- run mock smokes;
- run release builds and zip generation only after version bump.

## Minimum Gate By Phase

Pure model changes:

```bash
node tools/mock-quora/validate-shared-moderation-fixtures.js
node test/sharedModeration.test.js
node test/sharedModerationFuzz.test.js
```

Mock harness changes:

```bash
node tools/mock-quora/smoke.js
timeout 90 tools/firefox-bidi/run-mock-smoke.sh
```

Runtime integration changes:

```bash
npm test
node tools/mock-quora/validate-shared-moderation-fixtures.js
node test/sharedModeration.test.js
node test/sharedModerationFuzz.test.js
node tools/mock-quora/smoke.js
timeout 90 tools/firefox-bidi/run-mock-smoke.sh
```

Release changes:

```bash
npm test
npm run prod
npm run build:chrome
npm run build:firefox
```

Release commands require version bump first.

## Open Test Work

- Wire `test/sharedModeration.test.js` and `test/sharedModerationFuzz.test.js`
  into `npm test` after package-script ownership is clear.
- Add import/recommendation reducer fuzzing.
- Add mock pages for mixed valid/malformed posts.
- Add runtime synthetic tests once the service-worker integration starts.
- Add live CDP proof validation only when the user explicitly wants live Quora
  testing.
