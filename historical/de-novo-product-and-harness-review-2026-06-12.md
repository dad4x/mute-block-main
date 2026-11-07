# De-Novo Product And Harness Review

> **Status: HISTORICAL** (24 Oct 2026). Product and harness review at 1.6.955 (12 Jun). A snapshot. Kept as a record. Do not implement from it. planning.md is the front door. Register: [notes register](../docs/notes-register.md).

Date: 2026-06-12

Scope: source-first review of the current local tree against the active product intentions, plus a separate review of the test and browser harness. This uses current dirty working-tree state, not only committed state.

## State Read

- Normal Git repo, not ADE.
- Current observed package version: `1.6.955`.
- Dirty tree includes product source, generated Chrome/Firefox outputs, manifests, tests, CDP helpers, `planning.md`, and `upgrade-regression-plan.md`.
- Main intent baseline: `planning.md` prioritizes queue execution/recovery, normal reconciler behavior, storage authority cleanup, and deterministic scheduler/storage tests. `architecture.md` says the service worker owns queue mutations, queue WAL/checkpoints are authority, runtime/dashboard/content state are observations or caches, and compact progress is projection only.
- Additional explicit intent from this review: eliminate the 80-row queue/dashboard limit and show all current work rows.

## Product Findings

### P1: Queue view still hard-caps dashboard rows at 80

Severity: high.

`shared/js/sw.js` still defines `MAX_COORDINATOR_QUEUE_VIEW_ITEMS = 80` at line 97, slices queue-view rows at line 6027, and returns `itemLimit`/`truncated` at lines 6038-6039. That directly conflicts with the intended show-all behavior.

The test suite now protects the wrong behavior: `test/p1-contract.test.js` asserts `MAX_COORDINATOR_QUEUE_VIEW_ITEMS = 80` and verifies queue-view construction uses the cap at lines 1417-1419.

Impact: the dashboard can omit current-work rows from normal inspection and per-row controls. Counts may remain accurate, but the product surface is still truncated.

Fix: remove the cap from the dashboard-facing queue view, change the contract test to reject the cap, and add a behavioral test with more than 80 rows asserting `items.length == total`.

### P2: Executor result accounting can label materialized work unresolved

Severity: medium.

`runCoordinatorExecutorApplyPhase()` can enqueue/open runtime work and then classify the case as unresolved/deferred. The relevant post-fill logic is around `shared/js/sw.js` lines 15691-15893. In particular, rows can be reported as `queued-authority-enqueue-deferred-by-capacity` even when the fill result opened a tab.

The synthetic test now encodes that ambiguity: `test/swSynthetic.test.js` lines 17671-17693 expects an unresolved `queued-authority-without-executor-surface` case with `fillResultReason == opened-tab`, then accepts either durable active materialization or rollback-after-materialization.

Impact: live diagnostics and Phase 8/9/10 reports can be harder to interpret because opened/materialized and unresolved/deferred are mixed.

Fix: split result categories so verified opened/durable-active work is consumed/materialized, while unresolved/deferred is reserved for no durable movement and no owned runtime actor. Tighten the synthetic assertion to one expected outcome.

### P3: Durable authority direction mostly matches the architecture

Severity: informational.

The current enqueue/reconcile direction is broadly right: durable WAL authority is persisted before execution, raw queue snapshot saves are rejected, and derived materialization failures are tracked separately. The remaining risk is size/coupling: `shared/js/sw.js` is about 30k lines, so authority, projections, executor state, runtime caches, and diagnostics are still tightly intertwined.

## Harness Findings

### H1: Contract tests enforce the wrong 80-row product behavior

Severity: high.

This mirrors P1. The contract at `test/p1-contract.test.js:1417` should be inverted or replaced. It currently prevents the intended all-rows dashboard behavior.

### H2: `swHarness` runs patched service-worker source

Severity: medium.

`test/lib/swHarness.js` reads `shared/js/sw.js` as text and rewrites it before VM execution. Examples: startup removal at lines 409-413, WAL checkpoint-switch patching at lines 420-424, executor-start failure injection at lines 433-436, and storage get/set/remove changes after harness deactivation at lines 437-449.

This is useful, but it means synthetic tests are not exactly production-source execution.

Fix: keep the patches but centralize/document every rewrite, and add a small no-patch service-worker smoke against fake browser APIs.

### H3: Synthetic tests auto-seed raw queue fixtures as WAL

Severity: medium.

`test/swSynthetic.test.js` wraps harness loading and, by default, converts a fixture with `mbCoordinatorQueue` but no WAL into segmented WAL storage at lines 181-217. That is convenient for WAL-authority tests, but can hide raw-snapshot migration or stale-residue behavior.

Fix: make WAL seeding explicit per test, or keep mandatory `seedRawQueueFixtureAsWal: false` cases for raw residue/migration behavior.

### H4: `test:parallel` ignores the planned concurrency cap

Severity: medium.

`tools/run-tests-parallel.js` defines all lanes at lines 10-60 and launches them all with `Promise.all(lanes.map(runLane))` at line 210. The plan called for a conservative concurrency cap and `TEST_PARALLEL_JOBS` override.

Impact: all six lanes start at once, including synthetic and scenario fuzz. The runner is useful and passed, but it does not yet implement the planned host-load discipline.

Fix: add a lane scheduler with default concurrency `min(4, availableParallelism)` and support `TEST_PARALLEL_JOBS`.

### H5: Static source contracts are overused for behavior

Severity: low.

`test/p1-contract.test.js` is valuable for forbidden legacy surfaces, but source-text assertions can preserve implementation details after intentions change. The 80-row assertion is the clearest example.

Fix: keep static contracts for forbidden APIs and architectural tripwires; prefer behavioral synthetic tests for visible product requirements.

## Validation

Passed:

- `node --check shared/js/sw.js`
- `node --check test/swSynthetic.test.js`
- `npm run lint:correctness`
- `npm run test:parallel`

`npm run test:parallel` summary: unit, WAL, contract, synthetic, scenario, and lint lanes all passed. Synthetic duration was about 331s.

## Suggested Fix Order

1. Remove the 80-row dashboard queue-view cap and update the tests that currently enforce it.
2. Tighten executor apply result semantics around opened/materialized versus unresolved/deferred.
3. Add a no-patch service-worker harness smoke.
4. Make synthetic WAL auto-seeding explicit.
5. Add the planned parallel-test concurrency scheduler.
