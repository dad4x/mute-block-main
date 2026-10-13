# Parallel Test Split Plan

Goal: shorten local validation wall time without changing the conservative
serial release gate.

## Scope

Add a parallel test runner and an `npm run test:parallel` script. Leave
`npm test` unchanged initially.

`test/swSynthetic.test.js` started as a single lane because it uses fake timers
and broad service-worker harness state. The first-pass runner now proves the
lane can run safely as one process, and the next useful split is to shard that
file across separate Node processes. Do not shard it inside one process.

## Status

Completed:

- Added `tools/run-tests-parallel.js`.
- Added `npm run test:parallel`.
- Kept `npm test` serial and unchanged.
- Added the lint/correctness lane.
- Added per-command timeouts so a hung child is terminated and the runner can
  still print its final summary.
- Verified the correctness lint lane runs without source-level suppressions.

Still planned:

- Shard `test/swSynthetic.test.js` across multiple Node processes.
- Add a concurrency cap so sharding does not oversubscribe the host.
- Keep serial `npm test` as the conservative release gate.

## Current Lanes

- `unit`
  - `node test/subject.test.js`
  - `node test/jobState.test.js`
  - `node test/storageInvariants.test.js`
  - `node test/rawReportPages.test.js`
  - `node test/sharedModeration.test.js`
  - `node test/contentActionSelectors.test.js`
  - `node test/contentSpaceScopedState.test.js`

- `wal`
  - `node test/walSnapshotStore.test.js`
  - `node test/walSnapshotStoreFuzz.test.js`

- `contract`
  - `node test/p1-contract.test.js`

- `synthetic`
  - `node test/swSynthetic.test.js`

- `scenario`
  - `node test/sharedModerationFuzz.test.js`
  - `node test/swScenarioFuzz.test.js`

Each lane should run its commands serially. The lanes themselves can run in
parallel.

Implemented first-pass lane set:

- `unit`: subject, job state, storage invariants, raw report pages, shared
  moderation, content action selectors, content space scoped state.
- `wal`: WAL snapshot store unit and fuzz tests.
- `contract`: P1 contract.
- `synthetic`: full `test/swSynthetic.test.js` as one unsharded process.
- `scenario`: shared moderation fuzz and service-worker scenario fuzz.
- `lint`: static correctness lint.

The lint lane runs `tools/lint-correctness.js` with no source-level correctness
suppressions.

## Synthetic Sharding

`test/swSynthetic.test.js` already registers tests in a `tests` array and
supports `SW_SYNTHETIC_TEST_FILTER`. Add index-based sharding next:

```text
SW_SYNTHETIC_TEST_SHARD_COUNT=4
SW_SYNTHETIC_TEST_SHARD_INDEX=0
```

Selection rule:

```js
selectedTests = selectedTests.filter((_, index) =>
  index % shardCount === shardIndex
)
```

The first implementation should use four synthetic shard lanes:

- `synthetic-0/4`
- `synthetic-1/4`
- `synthetic-2/4`
- `synthetic-3/4`

Each shard is a separate `node test/swSynthetic.test.js` process. The final
summary must print the exact shard command so a failed shard can be rerun
directly.

Do not start with eight synthetic shards. This machine should be treated as
four physical cores with eight hyperthreads. Four is the safer default target
for this workflow, and the other lanes also consume CPU. Hyperthreads can
absorb short bursts, but more than eight concurrent test processes is not
expected to help and may create timer or timeout noise.

After index sharding is stable, optionally add timing-balanced sharding:

- Emit per-test timings from `swSynthetic` when requested.
- Save timings to a repo-local temporary artifact.
- Assign tests greedily by previous duration.

This is a second pass only. The first acceptance target is simple, reproducible
index sharding.

## Concurrency Target

The runner should choose a conservative default concurrency instead of starting
all lanes and shards blindly.

Recommended default:

- Query `os.availableParallelism()` when available, otherwise `os.cpus().length`.
- Query `os.loadavg()[0]` on platforms that expose it.
- Default to `min(4, availableParallelism)` because the practical target is the
  four physical cores, not all eight hyperthreads.
- Allow an override such as `TEST_PARALLEL_JOBS=6`.
- Hard cap at 8 unless explicitly changed later.

For a four-physical-core / eight-hyperthread machine, target four concurrent child
processes by default. A good schedule is:

- Run lint, contract, unit, and WAL/scenario lanes early.
- Keep no more than four synthetic shards active at once.
- If non-synthetic lanes are still running, count them against the same
concurrency budget.

## Implementation

Add `tools/run-tests-parallel.js`.

Runner behavior:

- Use `child_process.spawn`.
- Prefix stdout/stderr line-by-line with the lane name, for example
  `[synthetic] ok - ...`.
- Track per-lane duration.
- Exit nonzero if any lane fails.
- Let already-running lanes finish after a failure; do not kill them by
  default.
- Enforce per-command timeouts so a hung child is terminated and the runner can
  still print its final summary.
- Print a compact final summary:
  - lane name
  - command count
  - pass/fail
  - duration
  - failing command, if any

Add this package script:

```json
"test:parallel": "node tools/run-tests-parallel.js"
```

Keep the existing `test` script unchanged.

For synthetic sharding, add environment support in `test/swSynthetic.test.js`:

```text
SW_SYNTHETIC_TEST_SHARD_COUNT
SW_SYNTHETIC_TEST_SHARD_INDEX
```

Validation rules:

- Invalid shard count or index should fail with a clear error.
- Shard count of `1` should be equivalent to the current full run.
- `SW_SYNTHETIC_TEST_FILTER` should apply before sharding so focused debugging
  still works.
- The runner summary should include shard index/count and duration.

## Validation

Run:

```bash
node --check tools/run-tests-parallel.js
node --check test/swSynthetic.test.js
npm run test:parallel
```

Also verify one direct shard command, for example:

```bash
SW_SYNTHETIC_TEST_SHARD_COUNT=4 SW_SYNTHETIC_TEST_SHARD_INDEX=0 node test/swSynthetic.test.js
```

## Acceptance

- `npm run test:parallel` passes.
- Output identifies the failing lane and command clearly.
- `npm test` remains serial and unchanged.
- `test/swSynthetic.test.js` remains one process per shard.
- A failed synthetic shard can be rerun from the printed command.
- Default concurrency does not exceed four child processes on the four-physical-
  core host, and never exceeds eight without an explicit override.
