# Regression Test Suite Ideas

Status: active supporting test strategy.

Canonical planning now starts at [planning.md](planning.md). Canonical
architecture starts at [architecture.md](architecture.md). Use this note for
test-suite ideas and coverage layering; fold priority changes back into
`planning.md`.

Context: the extension depends on live Quora pages, browser extension runtime behavior, service-worker lifetime, and sometimes security/challenge pages. A fully reproducible end-to-end environment is not realistic right now. The regression suite should therefore be layered: deterministic tests block obvious regressions, captured fixtures cover known page shapes, and live CDP probes provide diagnostic confidence without pretending Quora is stable.

## Current Status

Status: partially implemented.

Already in the current tree:

- pure job-state tests: `test/jobState.test.js`;
- static contract tests: `test/p1-contract.test.js`;
- a service-worker synthetic harness and tests:
  `test/lib/swHarness.js` and `test/swSynthetic.test.js`;
- an optional deterministic service-worker scenario fuzzer:
  `test/swScenarioFuzz.test.js`, runnable with `npm run test:sw-fuzz`;
- raw captured-page fixture inventory tests:
  `test/lib/rawReportPages.js`, `test/rawReportPages.test.js`, and
  `test/fixtures/raw-report-pages/README.md`;
- `npm test` now runs `subject`, `jobState`, `storageInvariants`,
  `rawReportPages`, `p1-contract`, and `swSynthetic`;
- mock Quora HTTP fixtures and smoke: `tools/mock-quora/`;
- Firefox BiDi mock smoke helpers: `tools/firefox-bidi/`;
- live CDP diagnostic helpers: `tools/cdp/`.

Still open:

- the current `test:sw-fuzz` seeds reproduce a queued-tab cleanup leak after
  restart/tab-removal/sweep interleavings, so the fuzzer is intentionally not
  wired into `npm test` until that runtime issue is fixed;
- extracted small DOM snippet tests for Quora page-shape drift;
- optional CDP snapshot plumbing for the reusable storage invariant checker;
- an optional live smoke wrapper that reports `passed`, `skipped`, or
  `blocked` and exports a transcript.

Available fixture source:

`test/fixtures/raw-report-pages/` contains ten saved Quora Space HTML captures
that should be used before inventing new synthetic page shapes. A quick
inventory gate now lives in `test/rawReportPages.test.js`; it checks that every
top-level capture includes `TribeFeed`, `puppeteer_test_link`,
`puppeteer_test_tribe_post_item_feed_story`, `q-click-wrapper`, and
`post_timestamp` markers. Canonical profile-link counts currently range from
26 to 184 per page after `shared/js/subject.js` normalization.

Current captured pages:

| Capture | Unique profile links |
| --- | ---: |
| `Anti Spam and Scam.html` | 27 |
| `Instant Block.html` | 86 |
| `Spam detectives.html` | 184 |
| `Taking out the Trash.html` | 109 |
| `The Obvious Troll shooting gallery.html` | 127 |
| `The Original Whack-A-Troll` saved page | 38 |
| `The Q defense crew...html` | 112 |
| `Troll Patrol` saved page | 34 |
| `Trolls galore.html` | 128 |
| `Umm, no.html` | 26 |

Use these as source material for small scrubbed fixtures. Do not make tests load
the multi-megabyte raw captures directly unless the fixture harness is
explicitly designed for slow exploratory checks.

## Goals

- Catch regressions in queue ownership, retry, resolver, and source-settlement behavior before packaging.
- Keep the fast gate runnable with `npm test`.
- Avoid requiring a live browser or a real Quora session for the core safety checks.
- Make live checks observable and repeatable enough to compare runs, even when they cannot be made hermetic.
- Record failures as queue/storage invariants whenever possible, not as brittle pixel or timing expectations.

## Non-Goals

- Do not try to build a complete Quora clone.
- Do not make live Quora behavior a hard local unit-test dependency.
- Do not use Puppeteer; live browser checks should continue to use direct Chrome DevTools Protocol tools.
- Do not require one giant "perfect" regression run before small source changes can be validated.

## Suite Shape

### 1. Pure Model Tests

Keep expanding the current `test/jobState.test.js` style. These should be the most trusted tests because they have no browser, storage, or DOM dependency.

Candidate coverage:

- `reduceJobEvent()` accepts valid queued/opening/active/terminal transitions and rejects stale attempts.
- Failed retry creates a fresh attempt identity and clears terminal/tab/lease fields.
- `unblock-unmute` retry keeps the reverse executor action even if an old caller passes `nuke`.
- Tab removal terminalizes active profile jobs.
- Tab removal terminalizes resolver-only jobs keyed by `resolve-profile:...`.
- Terminal events are idempotent: a second terminal event for the same attempt cannot corrupt the final row.
- Security-verification failures are non-retryable unless a later fresh transient signal proves the row was stale.
- Queue rows expose one canonical envelope: `jobKey`, `actionKind`, `canonicalSubject`, `scope`, and attempt fields.

Acceptance: `npm test` fails if these invariants are broken.

### 2. Service-Worker Model Harness

Add a small harness that runs selected service-worker queue functions against fake browser APIs:

- fake `browser.storage.local` with observable read/write history;
- fake `browser.tabs` create/update/remove/query;
- fake runtime messages;
- controllable clock;
- controllable timers or explicit timer flushing;
- hooks for service-worker restart by clearing in-memory maps while preserving storage.

This should not start by loading the whole extension as a browser would. Start with extracted or exported helpers that model the dangerous behavior:

- enqueue coordinator work;
- claim a pending tab action;
- record milestone/terminal progress;
- handle tab removal;
- repair stale active rows;
- retry/requeue failed rows;
- settle source pending/nuked post records.

First scenarios:

- queued profile succeeds and closes;
- queued profile tab disappears before terminal;
- resolver-only source page resolves to a profile and becomes URL-backed work;
- resolver-only source page fails to resolve and clears `resolverPending`;
- failed `unblock-unmute` row is retried as `unblock-unmute`;
- idle retry creates a new attempt id and rejects stale terminal progress from the old attempt;
- service-worker restart reconstructs a pending tab action from durable queue state;
- pause/cancel clears profile-href rows and coordinator-key-only resolver rows.

Acceptance: these tests prove state transitions and storage writes without a live browser.

Current fuzzer:

- `test/swScenarioFuzz.test.js` drives the service worker through fake
  `enqueue-coordinator-items`, `claim-tab-action`, milestone/terminal progress,
  stale-attempt progress, tab update/removal, pause/resume/cancel/repair,
  explicit stale sweeps, fake-time jumps, and service-worker reloads.
- It is seed replayable. Use
  `SW_SCENARIO_FUZZ_SEED=0xc0de SW_SCENARIO_FUZZ_STEPS=36 node test/swScenarioFuzz.test.js`
  for one current short failing replay.
- Default seeds are `0x5eed`, `0xc0de`, and `0x51a7e`, with 36 steps each.
- The harness restart path preserves fake browser tabs and advances the next
  fake tab id, so restart tests model a service-worker reload rather than a
  fake browser restart.
- Invariants after every step run `checkStorageInvariants()`, preserve
  storage-only rows as storage-only, require active queued tabs to exist in the
  fake browser, and require queued-tab metadata to have attempt identity and not
  outlive its fake tab after settle/sweep.

Current reproduced failure:

- Symptom: `queuedTabMetadata` can retain an entry for a fake tab that has been
  removed and then swept.
- Example replay: seed `0xc0de`, step 9, trace:
  executable enqueue, terminal progress, second executable enqueue,
  storage-only enqueue, tab update, service-worker restart, stale milestone,
  third executable enqueue, remove active tab.
- Why this matters: stale in-memory metadata can make later queue ownership,
  stale-attempt filtering, and tab-close accounting reason about a tab that no
  longer exists.
- Gate status: optional known-failing fuzz gate for now. Promote it into
  `npm test` after the cleanup leak is fixed.

### 3. Static Contract Tests

Continue the current `test/p1-contract.test.js` pattern for source-level contracts that are hard to exercise directly while the service worker is still monolithic.

Good contract checks:

- queued content progress is service-worker-owned;
- record-nuke-progress compatibility cannot drive authoritative queue rows;
- active queued jobs have a wall-clock cap;
- hidden queued profile jobs do not depend on foreground promotion;
- aggregate space-feed buttons persist entry identity, not only profile URLs;
- unresolved resolver rows clear pending resolver records;
- no Puppeteer dependency or imports are reintroduced;
- disabled foreground-promotion scaffolding is removed once the no-promotion model is final.

These tests are not a substitute for behavioral tests, but they are useful tripwires while the code is still difficult to instantiate.

Acceptance: every contract describes a specific regression already seen or a deliberate architecture boundary.

### 4. Captured DOM Fixture Tests

For content-script page detection, use captured HTML snippets rather than live Quora. Keep fixtures small and scrubbed.

Candidate fixtures:

- asset-space feed with normal profile-backed posts;
- target-space feed where the visible header profile should be queueable;
- feed with resolver-only posts that have post URLs but no profile URL;
- mixed aggregate feed with one profile-backed post and one resolver-only post;
- contributor modal with rows that lack follow proxy controls;
- question page and other non-profile false positives;
- security/challenge page signatures.

Raw source material:

- mine `test/fixtures/raw-report-pages/*.html` first for the Space-feed cases;
- preserve only the minimum post/header/modal subtree needed for each fixture;
- keep a small manifest that records source capture, sanitized fixture purpose,
  expected profile count, expected resolver-only count, and expected post keys;
- avoid checking in copied images, webpack bundles, or full saved-page asset
  directories as test fixtures.

Test targets:

- post root selection;
- profile candidate extraction;
- resolver-only classification;
- aggregate button selection payload;
- queueable count versus queued entry count;
- modal contributor row queueability;
- canonical subject normalization.

Implementation options:

- Prefer extracting pure DOM-walking helpers that accept a root node and return plain objects.
- If a DOM library is added, keep it dev-only and use a small fixture set.
- If avoiding new dependencies, keep static contract tests for now and defer DOM execution until helpers are easier to isolate.

Acceptance: known page-shape drift is represented by a fixture before the next source change tries to fix it.

### 5. Storage Invariant Checks

Add a reusable invariant checker for persisted extension state. It can run in pure tests against fixture JSON and in CDP probes against live storage snapshots.

Useful invariants:

- run counts match queue rows for that run;
- no terminal row keeps an active tab lease;
- no active row lacks a live tab unless it is within the allowed repair window;
- no `resolverPending` source record remains after the matching resolver row is terminal unresolved;
- pending post `remainingUrls` contains only unfinished profile jobs;
- `jobKeysByProfileHref` agrees with `remainingUrls`;
- failed retry rows have newer attempt ids than the failed rows they replaced;
- source settlement is idempotent if terminal rows are processed twice.

Acceptance: invariant failures should produce compact JSON output naming the row, run, post key, and violated rule.

### 6. Live CDP Smoke Probes

Keep live validation as a smoke and diagnosis layer, using the existing `tools/cdp` style. These should be run manually or as an optional script when a live Windows Chrome profile and Quora session are available.

Suggested probes:

- reload extension and report version plus extension errors;
- summarize queue and open profile tabs before a run;
- inspect one known space tab and record visible candidates, resolver-only entries, pending posts, queue rows, and owner state;
- queue a tiny batch if a suitable page is already open;
- wait/poll queue counts;
- summarize failures and pending records afterward;
- export a JSON transcript for comparison with prior runs.

Hard-fail only on extension-level invariants:

- service worker throws;
- extension error console has new fatal errors;
- queue storage violates invariant checks;
- a worker tab remains active past the configured cap with no live tab;
- source pending records stay busy after terminal rows are settled.

Do not hard-fail just because Quora showed no candidates, changed layout, challenged the session, or the target page was not open. Those should be reported as skipped/blocked with evidence.

### 7. Regression Case Ledger

Create a small ledger of historical regressions, each with the best available test layer:

- reverse action retried as `nuke`: pure model test plus contract check;
- idle retry reused attempt id: pure model test;
- resolver unresolved left source pending: service-worker harness plus storage invariant;
- aggregate mixed resolver/profile click dropped resolver-only entries: content fixture plus contract check;
- stale active rows survived tab disappearance: service-worker harness plus storage invariant;
- service-worker restart lost pending tab action: harness restart scenario;
- foreground fallback drift: static contract until source scaffolding is removed;
- contributor modal rows not queueable: DOM fixture;
- target-space header profile missed: DOM fixture.

Each ledger entry should name:

- symptom;
- minimal state/page fixture;
- owning test file;
- whether it is a hard gate or optional smoke;
- last known version where it was verified.

### 8. Test Commands

Keep command layers explicit:

- `npm test`: fast deterministic gate; no browser; required after pure source changes.
- `npm run test:sw-fuzz`: deterministic fake-service-worker scenario fuzzer;
  currently known-failing on the queued-tab metadata cleanup leak.
- `node --check ...`: syntax gate for changed JS files and CDP tools.
- `node tools/cdp/reload-extension.js`: optional live reload check when Chrome CDP is available.
- `node tools/cdp/queue-summary.js`: optional live queue summary.
- `node tools/cdp/inspect-space-state.js --needle <space>`: optional source-page and pending-state inspection.
- future `npm run test:fixtures`: captured DOM fixtures if a DOM harness is added.
- `node test/storageInvariants.test.js`: storage invariant checks over plain
  persisted-state snapshots.
- future `npm run test:invariants`: larger fixture batches and, optionally, CDP
  snapshot validation.
- future `npm run test:live-smoke`: best-effort CDP probe that reports `passed`, `skipped`, or `blocked`.

## Implementation Order

1. Done: add pure job-state coverage and contract tripwires.
2. Done: add an initial service-worker synthetic harness and include it in
   `npm test`.
3. Done: add mock Quora, Firefox BiDi, and CDP helper layers.
4. Done: add storage invariant helpers that can run on plain objects.
5. Done: move the full saved page captures under `test/fixtures/` and add a
   raw capture inventory gate.
6. Still open: convert the highest-value page-shape examples into small
   captured DOM snippet fixtures.
7. Still open: wrap live CDP probes into an optional smoke script that exports a
   transcript.
8. Ongoing: retire static contract checks as behavior moves into pure model,
   synthetic, invariant, or fixture tests.

## Practical Bar

The suite is successful if most regressions can be reduced to one of these artifacts:

- a plain queue item and event sequence;
- a storage JSON snapshot;
- a small DOM fixture;
- a CDP transcript showing why the live environment was skipped or blocked.

That gives repeatability where the project can have it, and honest diagnostics where it cannot.
