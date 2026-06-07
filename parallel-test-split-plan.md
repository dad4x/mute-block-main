# Parallel Test Split Plan

Goal: shorten local validation wall time without changing the conservative
serial release gate.

## Scope

Add a parallel test runner and an `npm run test:parallel` script. Leave
`npm test` unchanged initially.

Do not shard `test/swSynthetic.test.js` internally. It should remain a single
process because it uses fake timers and broad service-worker harness state.

## Proposed Lanes

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

## Validation

Run:

```bash
node --check tools/run-tests-parallel.js
npm run test:parallel
```

Do not modify test files as part of this split unless a true runner interaction
bug is discovered.

## Acceptance

- `npm run test:parallel` passes.
- Output identifies the failing lane and command clearly.
- `npm test` remains serial and unchanged.
- `test/swSynthetic.test.js` remains one process.
