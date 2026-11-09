# Shared Moderation Live Operation Test Outline, 2026-05-20

> **Status: ROADMAP** (24 Oct 2026). Future live-test outline. Not current. Not scheduled. Check planning.md before acting on it. Register: [notes register](docs/notes-register.md).

Status: future live-test plan.

Canonical planning now starts at [planning.md](planning.md). Canonical
architecture starts at [architecture.md](architecture.md). Use this after pure
and mock shared-moderation gates are stable; it is not a current runtime
implementation order.

This outline is for testing actual operation as shared moderation moves from
pure reducers into execution. It assumes we proceed in small steps and stop at
each gate until the previous one is boringly repeatable.

The core rule remains: imported moderation data is review and policy input, not
a remote command channel. Live tests should be designed to catch any bypass of
that rule.

## Phase 0: Preflight Baseline

Run before each execution-facing slice.

Commands:

```bash
node tools/mock-quora/validate-shared-moderation-fixtures.js
node test/sharedModeration.test.js
node test/sharedModerationFuzz.test.js
node tools/mock-quora/smoke.js
timeout 90 tools/firefox-bidi/run-mock-smoke.sh
npm test
```

Acceptance:

- all current pure, mock, and package tests pass;
- no release build was run without version bump;
- production manifests still have no broad localhost permissions;
- no runtime source has a duplicate MBLOCK parser.

## Phase 1: Runtime Import Observation Only

Goal: prove the extension can observe shared posts and parse MBLOCK documents
without applying anything.

Test setup:

- use mock Quora first;
- use temporary dev manifest only for localhost;
- use direct Firefox BiDi or CDP tooling, not Puppeteer;
- use a page with valid, malformed, and absent MBLOCK posts.

Assertions:

- content/runtime reads rendered post text;
- all parsing goes through `parseMblockBlocks`;
- malformed blocks are visible as parse failures;
- valid external journals create import/recommendation candidates only;
- self journals create no actionable imports;
- unknown-source journals create no actionable imports;
- no queue rows, registry writes, or progress records are created.

Stop condition:

- any imported remote event causes direct execution or direct registry mutation.

## Phase 2: Review Inbox Operation

Goal: prove imported inputs are stable review records across UI and storage.

Test setup:

- import external profile action events and Space classification events;
- reload dashboard/coordinator;
- restart service worker if practical;
- re-import the same source post.

Assertions:

- profile inputs appear as review records only;
- Space classifications appear as recommendations only;
- duplicate import does not duplicate rows;
- dismiss is durable and idempotent;
- apply is durable and idempotent;
- dismissed records do not immediately resurrect on re-import;
- records expose source document, source event id, publisher, and timestamp.

Stop condition:

- dashboard or content script writes lower-level storage directly rather than
  routing through service-worker/storage authority.

## Phase 3: Apply Without Execution

Goal: prove accepting shared moderation creates local intent, not immediate
remote action.

Profile input assertions:

- applying an imported profile event records a local decision;
- local decision can be reviewed before queueing;
- no profile tab opens from apply alone unless the chosen policy explicitly
  says queue/run and routes through the normal queue authority.

Space recommendation assertions:

- accepting a Space recommendation creates a local Space classification event
  payload;
- registry update, if enabled in this slice, goes through the planned registry
  authority path;
- accepting neutral clears mode;
- accepted recommendation cannot bypass local event creation.

Stop condition:

- apply uses the imported event as if it were a local command.

## Phase 4: Queue Integration For Accepted Profile Inputs

Goal: prove accepted profile actions join the existing queue model cleanly.

Test setup:

- use mock profile pages where possible;
- use small batches with one accepted profile input at first;
- test foreground and hidden-profile policy separately.

Assertions:

- queue work starts only after local accept/policy decision;
- queue rows have normal job envelope fields and attempt identity;
- service worker owns execution;
- content script can claim only the current queued attempt;
- direct foreground mute/block/close buttons remain explicit user-directed
  exceptions;
- pause, resume, cancel, stale tab close, and already-blocked repair behave as
  current queue tests expect.

Stop condition:

- imported records are converted directly into progress records or primitive
  storage updates.

## Phase 5: Mock Export Operation

Goal: prove local events can be exported through the mock composer path with
proof before any live post.

Test setup:

- local pending events below threshold;
- local pending events at threshold;
- manual publish below threshold;
- mock composer success;
- mock composer failure;
- proof missing document id;
- proof missing one event id.

Assertions:

- automatic export skips below threshold;
- manual export can override threshold;
- export attempt is leased or otherwise single-owner;
- failure leaves events pending;
- proof must include document id and all event ids;
- success marks only verified events exported;
- service-worker restart does not double-post or falsely mark exported.

Stop condition:

- any event becomes exported without `verifyPostedProof` passing.

## Phase 6: Controlled Live Read

Goal: read real Quora-rendered shared moderation posts without posting.

Preconditions:

- mock import path is green;
- runtime import observation is green;
- user explicitly selects the target Space/post;
- use direct CDP/BiDi tooling.

Assertions:

- rendered text can be captured from a real post;
- MBLOCK extraction succeeds or fails with explainable evidence;
- Quora link rewriting does not corrupt canonical subjects inside MBLOCK JSON;
- failures are reported as parse/import failures, not silently ignored success.

Stop condition:

- real-site selector drift causes ambiguous success.

## Phase 7: Controlled Live Publish

Goal: publish one deliberate shared moderation post to a controlled test Space.

Preconditions:

- mock export operation is green;
- live read is green;
- user explicitly approves the live post;
- test Space is controlled;
- pending event set is tiny and inspectable.

Assertions:

- post body contains human text plus MBLOCK appendix;
- after publication, rendered post is re-read;
- `verifyPostedProof` passes with expected document id and event ids;
- local exported state changes only after proof;
- if Quora composer fails, local events remain pending;
- if proof fails, local events remain pending.

Stop condition:

- live post succeeds but local proof path cannot verify it.

## Phase 8: Recovery And Restart Runs

Goal: prove live operation survives the service-worker scheduling model.

Scenarios:

- service worker sleeps after import but before review;
- service worker sleeps after apply but before queue start;
- service worker sleeps during export attempt;
- browser restart after pending import;
- browser restart after export success but before cleanup;
- storage delay during inbox update;
- storage delay during export-state update.

Assertions:

- normal operation resumes from authoritative state;
- repair can fix stranded state but is not the primary path;
- no duplicate queue execution;
- no duplicate post;
- no false exported status;
- metrics distinguish normal progress from repair-driven progress.

Stop condition:

- repair becomes the expected way an import, apply, queue, or export completes.

## Phase 9: Metrics To Watch During Live Runs

Capture at minimum:

- number of parsed posts;
- valid MBLOCK count;
- invalid MBLOCK count by reason;
- imported profile input count;
- imported Space recommendation count;
- dismissed/applied counts;
- queue rows created from accepted inputs;
- direct foreground button actions;
- export attempts, successes, proof failures, composer failures;
- service-worker restarts during import/export;
- storage write delay and batch size;
- repair invocations tied to shared moderation paths.

Useful ratios:

- imported records to accepted records;
- accepted records to queued records;
- export attempts to verified exports;
- repair completions to normal completions;
- duplicate imports suppressed per source post.

## Phase 10: Release Readiness Gate

Before packaging:

- wire shared moderation direct tests into `npm test`;
- run pure, mock, runtime, and package tests;
- perform at least one controlled live read;
- perform live publish only if the shipped behavior includes publishing;
- review metrics for repair-heavy operation;
- bump version before release builds.

Release validation:

```bash
npm test
npm run prod
npm run build:chrome
npm run build:firefox
```

## First Slice Recommendation

Start with Phase 1 only:

- mock page with valid, malformed, and no MBLOCK posts;
- runtime parser path uses `parseMblockBlocks`;
- output goes to an observable import preview or diagnostic only;
- assert that queue, registry, progress, and export state are unchanged.

That slice should flush out parser wiring, source classification, and authority
boundary problems before any execution behavior is exposed.
