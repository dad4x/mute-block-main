# Refactor 1.6 Plan

The `main` line now starts the `1.6` architecture reset. The public release
target for this work is `2.0`.

## Branch Policy

- `release/1.4` remains the maintenance lane for the `1.4.247` baseline.
- `refactor/1.5` is preserved as the last `1.5.x` coordinator/debugging lane.
  A local copy also exists at `../mute-block-1.5`.
- `main` is the active `1.6` development lane and should absorb the durable
  job/state-machine work from `top-level-rethink-1.5.md` and
  `top-level-rethink-1.5-execution-plan.md`.
- Treat the eventual public release as `2.0`, not as a public `1.6.x` release,
  unless that strategy is deliberately changed later.

## Execution Strategy

Use `top-level-rethink-1.5-execution-plan.md` as the implementation checklist.
The note was written during the late `1.5` rethink, but its execution belongs
to `1.6` on `main`.

The first implementation slice remains:

- add `shared/js/jobState.js`;
- add `test/jobState.test.js`;
- update `npm test` to run both current tests;
- avoid scheduler behavior changes in that slice.

## Validation Policy

Quora behavior still needs both contract tests and live browser probes:

- run `npm test` after pure-state changes;
- before any release-oriented rebuild, bump version first;
- for shipped behavior changes, rebuild Chrome and Firefox local outputs and
  run live canaries from `coordinator-page-refactor-plan-2026-05-08.md`.

## Manual Probe Matrix

- Single profile `Mute Block`.
- Single profile `Mute Block Close`.
- Already-blocked profile.
- Profile unavailable or redirected profile.
- Followers/following modal `Open Profiles`.
- Followers/following modal `Nuke 'Em`.
- Asset space top-level and per-post `Nuke 'Em`.
- Target space top-level and per-post `Nuke 'Em`.
- Large nuke run with background tabs.
- Pause, coordinator-close, source-page-close, worker-tab-close behavior.
- Reload/restart during queued, opening, active, acting, and settling states.
- Browser error page or security verification page.
