# Space Nuke Handoff 2026-05-03

This note captures older `1.4` local state after the `Nuke 'Em` hover update and the user-reported unresponsive-page behavior during large space nukes.

Status update: this note is now superseded by [refactor-1.5-plan.md](refactor-1.5-plan.md) for the active `1.5` architecture reset. The event-churn hypothesis below remains useful historical context for why progress and queue state are being refactored.

## Current State

- Repo: `/scratch/dbrower/home/src/mute-block-main`
- Local packaged version at the time of this note: `1.4.246`
- Rebuilt artifacts:
  - `chrome/mute_block-1.4.246.zip`
  - `firefox/mute_block-1.4.246.zip`
- Latest completed user-facing change:
  - the `Nuke 'Em` hover text now includes the deduped candidate count before the preview list
  - implementation is in `shared/js/content.js`, inside `buildNukeTargetsHelpText()`

## What Changed In This Turn

- bumped:
  - `package.json`
  - `package-lock.json`
  - `manifests/chrome.json`
  - `manifests/firefox.json`
- updated `shared/js/content.js` so hover/help text renders as:
  - `Queue detected profiles from visible posts in this space for mute and block (N candidates)`
- rebuilt production assets with:
  - `npm run prod`
  - `npm run build:chrome`
  - `npm run build:firefox`

## Verification

These commands completed successfully:

- `npm run prod`
- `npm run build:chrome`
- `npm run build:firefox`

Built zip outputs present locally:

- `chrome/mute_block-1.4.246.zip`
- `firefox/mute_block-1.4.246.zip`

## User Report Still Open

The hover-count request is done. The unresponsive-page report is not resolved yet.

The user provided a large `Mute-Block Extension Info` dump from `1.4.245` after a space nuke run. The strongest signals in that report were:

- `actionable_candidates: 69`
- `pending: 0`
- many entries eventually reached blocked or already-blocked states
- several entries emitted repeated `Profile confirmed blocked by background sweep` events
- a few entries still ended in interrupted or error states during the large run

Important examples from the pasted report:

- repeated blocked-sweep chatter on already-settled rows
- interrupted rows such as `CareSuper` and `Henry-Armstrong-54`
- non-profile or unavailable targets such as `Mo` and `Elianna-Barrett-5-answers-2`

## Current Hypothesis

The current best lead is event churn during large space nukes, not a proven semantic failure in the hover or candidate-detection logic.

The likely hot path to inspect next is the interaction between:

- `shared/js/sw.js`
  - `sweepOwnedBlockedProfileTabs()`
  - background-side `recordProfileNukeProgress()` calls
- `shared/js/content.js`
  - `recordProfileNukeProgress()`
  - `recordProfileNukeProgressBatch()`
  - `reconcileStaleSpaceFeedProgress()`

Reason:

- the report showed many repeated background-sweep confirmations for rows that were already effectively settled
- the current codebase has a lot of recent progress-tracking and reconciliation machinery in both content and service worker paths
- repeated storage writes plus repeated UI refresh scheduling is a plausible source of page-unresponsive behavior when many queued profiles are active at once

This is still a hypothesis. No root cause was proven in this turn.

## Practical Next Steps

1. Reproduce the large-nuke run with the `1.4.246` build, not the older `1.4.245` report.
2. Add temporary logging or counters around:
   - `sweepOwnedBlockedProfileTabs()`
   - `recordProfileNukeProgress()`
   - `recordProfileNukeProgressBatch()`
   - `reconcileStaleSpaceFeedProgress()`
3. Check whether the same profile record is being re-written repeatedly after it is already in a terminal state.
4. If confirmed, short-circuit duplicate blocked-sweep updates and avoid redundant UI refresh scheduling for already-settled rows.

## Worktree Context

This repo was already dirty beyond the hover-count change. At the time of this note, modified files included:

- `AGENTS.md`
- `package.json`
- `package-lock.json`
- `manifests/chrome.json`
- `manifests/firefox.json`
- `readme.md`
- `shared/css/content.css`
- `shared/js/content.js`
- `shared/js/spaceRegistry.js`
- `shared/js/sw.js`

Treat the hover-count change as only one small part of a larger in-progress local state.
