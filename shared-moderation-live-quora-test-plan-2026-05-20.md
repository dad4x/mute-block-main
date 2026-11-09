# Shared Moderation Live Quora Test Plan, 2026-05-20

> **Status: ROADMAP** (24 Oct 2026). Future live Quora test plan. Not current. Not scheduled. Check planning.md before acting on it. Register: [notes register](docs/notes-register.md).

Status: future live-Quora test plan.

Canonical planning now starts at [planning.md](planning.md). Canonical
architecture starts at [architecture.md](architecture.md). Use this only when
shared moderation is ready for controlled real-post trials.

This plan is for the first real Quora trials of shared moderation. It is more
specific than the broader live-operation outline: this is the ordered sequence
for testing against real posts.

Use direct CDP/BiDi tooling. Do not use Puppeteer.

## Ground Rules

- Stop after each phase until the result is repeatable and understood.
- Start read-only. Do not combine read, import, apply, queue, and export in one
  first pass.
- Use controlled test Spaces and controlled posts.
- Do not treat imported moderation as a remote command channel.
- Do not mutate queue, registry, progress, or export state until the current
  phase explicitly allows it.
- If proof, parsing, source classification, or authority routing is ambiguous,
  report failure and stop.

## Preflight

Run before any live Quora trial:

```bash
node tools/mock-quora/validate-shared-moderation-fixtures.js
node test/sharedModeration.test.js
node test/sharedModerationFuzz.test.js
node tools/mock-quora/smoke.js
timeout 90 tools/firefox-bidi/run-mock-smoke.sh
npm test
```

Acceptance:

- all commands pass;
- production manifests are unchanged;
- no duplicate MBLOCK parser exists in runtime code;
- current browser session is known and attached through approved CDP/BiDi path.

## Phase 1: Live Read Only

Purpose: prove we can read a real Quora post and parse a simple MBLOCK appendix.

Setup:

- one controlled post in a controlled test Space;
- post contains human text plus one valid `MBLOCK:BEGIN v=1` block;
- no import/storage mutation enabled.

Assertions:

- rendered post text is captured;
- `parseMblockBlocks` returns one valid block;
- document id, schema, event ids, and event types are reported;
- queue, registry, progress, import inbox, recommendation inbox, and export
  state do not change.

Stop if:

- selector drift makes the captured text ambiguous;
- rendered text corrupts the JSON block;
- any state mutates.

## Phase 2: Live Read With Bad Inputs

Purpose: verify live rendered text handling for invalid or mixed posts.

Setup posts:

- no MBLOCK;
- malformed MBLOCK JSON;
- multiple valid MBLOCK blocks;
- prose plus JSON-looking text outside MBLOCK markers;
- truncated end marker.

Assertions:

- no-MBLOCK post reports no blocks;
- malformed block reports parse error without throwing;
- valid multiple blocks parse independently;
- JSON-looking prose is ignored;
- truncated marker does not create a valid document;
- no import, queue, registry, progress, or export state changes.

Stop if:

- invalid input silently reports success;
- an invalid post creates imported records.

## Phase 3: Source Classification

Purpose: prove live publisher/source identity does not create action authority.

Setup:

- one live post treated as self/local publisher;
- one live post treated as external/test publisher;
- one post with unknown or missing publisher metadata, if possible.

Assertions:

- self journal creates no actionable import;
- external journal creates candidates only;
- unknown-source journal creates no actionable import;
- source identity, document id, and event ids are visible in diagnostics.

Stop if:

- self or unknown source can produce action candidates;
- external source bypasses candidate/review state.

## Phase 4: Import Preview

Purpose: let real external data reach review inboxes, but not execution.

Allowed mutation:

- import inbox and Space recommendation inbox only.

Assertions:

- external profile events become profile review inputs;
- external Space classifications become recommendations;
- dashboard reload preserves records;
- service-worker restart preserves records;
- re-reading the same post suppresses duplicates;
- no queue rows, registry writes, profile tabs, progress records, or export
  records are created.

Stop if:

- import writes directly to lower-level storage primitives;
- remote event creates executable queue/progress state.

## Phase 5: Dismiss And Reimport

Purpose: prove live imports have stable tombstone/idempotence behavior.

Actions:

- dismiss one imported profile input;
- dismiss one Space recommendation;
- re-read the same live post;
- restart service worker and re-read again.

Assertions:

- dismissed records remain dismissed;
- duplicate source data does not resurrect dismissed records immediately;
- source metadata remains available for audit;
- no queue or registry action occurs.

Stop if:

- dismissed live records reappear as fresh actionable inputs.

## Phase 6: Apply Without Execution

Purpose: prove accepting shared data creates local intent, not immediate remote
action.

Order:

1. Apply a Space recommendation first.
2. Apply a profile moderation input with execution disabled or dry-run.

Assertions for Space recommendation:

- acceptance creates a local Space classification event payload;
- any registry update uses the intended registry authority path;
- accepted recommendation is marked applied idempotently;
- no profile tabs or queue rows appear.

Assertions for profile input:

- acceptance creates local reviewed intent;
- no Quora mute/block action happens;
- no queue row appears unless this phase explicitly enables dry-run queue
  projection.

Stop if:

- applying imported data acts as if the imported event were a local command.

## Phase 7: One Controlled Profile Queue Action

Purpose: verify accepted profile moderation can enter normal queue authority.

Setup:

- one controlled, reversible profile target;
- one accepted imported profile input;
- start with mute before block or mute+block;
- no batch execution.

Assertions:

- queue work starts only after local accept/policy decision;
- queue row has normal envelope fields and attempt identity;
- service worker owns execution;
- content script claims only the current queued attempt;
- terminal status is consistent with existing queue tests;
- no direct imported-event progress write occurs.

Stop if:

- imported data bypasses queue authority;
- action result depends on repair as the normal completion path.

## Phase 8: Mock Export Recheck

Purpose: re-prove proof discipline before live posting.

Actions:

- export below threshold automatically;
- publish manually below threshold;
- publish at threshold;
- force mock proof failure for missing document id;
- force mock proof failure for missing event id.

Assertions:

- automatic below-threshold export skips;
- manual export can override threshold;
- failure leaves local events pending;
- only `verifyPostedProof` success can mark events exported;
- service-worker restart does not double-post.

Stop if:

- any event becomes exported without proof.

## Phase 9: Live Readback Of Manual Post

Purpose: test proof logic against real Quora rendering without automated live
posting.

Setup:

- manually create a tiny controlled live post containing one MBLOCK document;
- local test expects that document id and event id.

Assertions:

- rendered live post is captured;
- proof logic finds document id and event id;
- failure mode is explicit if Quora rendering changes text;
- no local export state mutates.

Stop if:

- proof path cannot reliably validate the manually posted block.

## Phase 10: One Controlled Live Publish

Purpose: publish one deliberate shared moderation post and verify it by
readback.

Preconditions:

- Phases 1 through 9 are green;
- user explicitly approves the live post;
- test Space is controlled;
- pending event set is tiny and inspectable.

Assertions:

- post body contains human text plus MBLOCK appendix;
- after publication, rendered post is re-read;
- `verifyPostedProof` passes with expected document id and all event ids;
- local exported state changes only after proof passes;
- composer failure leaves events pending;
- proof failure leaves events pending.

Stop if:

- live post succeeds but local proof cannot verify it;
- local state marks exported before readback proof.

## Phase 11: Restart And Delay Scenarios

Purpose: make sure the service-worker scheduling model does not turn repair
into the normal path.

Scenarios:

- service worker sleeps after live read before import;
- service worker sleeps after import before review;
- service worker sleeps after apply before queue start;
- browser restart after pending import;
- browser restart after successful export before cleanup;
- storage delay during import inbox write;
- storage delay during export status write.

Assertions:

- authoritative state resumes normal operation;
- no duplicate import rows;
- no duplicate queue execution;
- no duplicate posts;
- no false exported status;
- repair invocations are rare and explainable, not the primary completion path.

Stop if:

- normal live operation requires repair to make progress.

## Metrics To Capture

For every live run, record:

- target Space/post URL;
- parser result: no block, valid block, malformed block;
- valid MBLOCK count;
- invalid MBLOCK count by reason;
- source relationship: self, external, unknown;
- profile inputs created;
- Space recommendations created;
- duplicate imports suppressed;
- dismissed and applied counts;
- queue rows created from accepted inputs;
- direct foreground actions;
- export attempts;
- proof successes and failures;
- composer failures;
- service-worker restarts during run;
- storage delay/write-batch metrics;
- repair invocations tied to shared moderation.

Important ratios:

- imported to accepted;
- accepted to queued;
- export attempts to verified exports;
- repair completions to normal completions;
- duplicates suppressed per source post.

## First Live Trial

The first real Quora trial should be:

1. open one controlled post;
2. capture rendered post text;
3. parse only with `parseMblockBlocks`;
4. print document id and event ids;
5. assert all mutable state surfaces are unchanged.

Do not import, apply, queue, publish, or export in the first live trial.
