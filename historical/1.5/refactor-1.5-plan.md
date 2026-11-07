# Refactor 1.5 Plan

This branch starts the `1.5` series. The goal is an internal architecture reset for the accreted `1.4` nuke, progress, and space-classification code while preserving the user-facing workflows that currently work.

## Branch Policy

- `release/1.4` is the maintenance lane for small fixes against the `1.4.247` baseline.
- `refactor/1.5` is allowed to reshape the `1.4` implementation because that series is treated as newly accreted AI-written code.
- Do not mix emergency `1.4` maintenance fixes into the refactor branch without first deciding whether they should also be cherry-picked to `release/1.4`.

## Testing Reality

Quora cannot be replicated locally in a useful way. The extension operates against a stateful live site with changing DOM and account-specific state.

Use two validation layers instead:

- Pure contract tests for deterministic logic such as URL normalization, subject identity, descriptor construction, queue state transitions, retry/drop decisions, and storage migration.
- Live manual probes on Quora for DOM recognition, destructive action targeting, modal workflows, space workflows, reload behavior, and interruption recovery.

## Target Architecture

Introduce explicit internal concepts before doing larger behavior changes:

- `subject`: canonical Quora profile identity, profile slug, display name, and future alias support.
- `targetDescriptor`: the actionable subject plus source URL, collector mode, evidence, confidence, and post key.
- `nukeRun`: owner tab, run id, source type, queue items, per-attempt status, and concurrency.
- `progressEvent`: append-style attempt event, not a repeated full-map rewrite.
- `domAdapter`: page-specific recognition and action binding, separated from queue/state logic.

## Work Plan

1. Start `1.5.0` and extract shared subject/profile normalization.
2. Add contract tests for pure subject behavior.
3. Add debug/export reporting for live Quora probes.
4. Move progress writes behind a single service-worker state store.
5. Scope queue scheduling by run and owner.
6. Convert space/modal collection output to target descriptors.
7. Make destructive mute/block action binding fail closed.
8. Migrate or safely ignore legacy `1.4` progress state.
9. Rebuild, package, and manually validate the live scenario matrix.

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
- Pause/owner-tab-close behavior.
- Reload during a run.
- Browser error page or security verification page.

## First Refactor Slice

The first slice is deliberately small:

- bump to `1.5.0`
- extract shared Quora profile subject normalization from `content.js` and `sw.js`
- add contract tests for that module
- keep built user-facing behavior unchanged
