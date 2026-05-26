# Refactor 1.6 Handoff - 2026-05-17

Status: historical handoff.

Canonical planning now starts at [planning.md](planning.md). Canonical
architecture starts at [architecture.md](architecture.md). Use this only to
recover the May 17 context; it is superseded for current priorities.

## Scope

Continue the `1.6` refactor/stabilization work in this normal Git repo:

- this is not ADE
- repo-local edits are already authorized
- do not ask for additional repo-local edit, test, build, package, or sync permission
- never use Puppeteer for live browser validation; use direct Chrome DevTools Protocol over the remote-debugging tunnel
- before shipped behavior changes, bump the version first, then rebuild and regenerate Chrome/Firefox zips

## Current Version and Artifacts

Latest source/package version: `1.6.213`.

Built artifacts exist:

- `chrome/mute_block-1.6.213.zip`
- `firefox/mute_block-1.6.213.zip`

The Windows Chrome unpacked extension was synced and reloaded to `1.6.213`.
Extension manager reported:

- `state: ENABLED`
- `version: 1.6.213`
- `manifestErrors: 0`
- `runtimeErrors: 0`
- `installWarnings: 0`

## Latest Slice

Primary files touched in the latest slice:

- `shared/js/jobState.js`
- `shared/js/content.js`
- `shared/js/sw.js`
- `test/jobState.test.js`
- `test/p1-contract.test.js`
- `package.json`
- `package-lock.json`
- `manifests/chrome.json`
- `manifests/firefox.json`

The repo was already intentionally dirty with broader refactor files. Do not
revert unrelated changes.

## What Changed in `1.6.213`

This slice completed the P1 action items from `review-findings.md`: make the
queue the authority for queued jobs.

The patch changed `shared/js/content.js` so active queued tabs no longer write
`mbProfileNukeProgress` locally first and then fall back to
`record-nuke-progress`. For active queued attempts, `recordProfileNukeProgress`
now sends only `record-job-milestone` or `record-job-terminal`; it updates the
content-script cache only after the service worker accepts the job-protocol
message.

The patch changed `shared/js/sw.js` so service-worker-owned queue rows are no
longer moved by storage-change or repair sync from `mbProfileNukeProgress`.
The mirror is still written for display/backward compatibility after accepted
job progress, but stale or missing queued-job messages do not update the mirror
first. Old `record-nuke-progress` messages arriving from a known queued tab are
rerouted into the job-progress path instead of the compatibility path.

The patch also added canonical job-envelope fields to queued rows and claims:

- `jobKey`
- `scope`
- `canonicalSubject` for profile jobs, or a source-page subject for
  profile-resolution jobs
- nested `attempt`

Physical storage keys remain compatible, but scheduling, claim payloads, retry,
and requeue now carry the canonical envelope.

The patch added `test/p1-contract.test.js` and included it in `npm test` to
guard these P1 boundaries until a full service-worker harness exists.

## Previous Important Slice: `1.6.212`

This slice addressed part of the deeper review finding that the reducer existed
in tests but was not yet participating in runtime queue-row changes.

The patch changed `shared/js/sw.js` so progress-derived coordinator queue
updates now pass through `reduceJobEvent()` before the service worker updates a
queue row. `transitionCoordinatorItemFromProgress()` now:

- converts progress-derived statuses into reducer events:
  `ENQUEUED`, `TAB_OPENED`, `MILESTONE`, `TERMINAL`, or `RETRY`
- lets legacy progress jump a queued row directly to `active`, matching the old
  mirror behavior where the first observed event can skip `opening`
- keeps a narrow reset-retry compatibility fallback for older progress mirror
  flows
- still preserves the legacy field shape for display/storage compatibility
  while taking reducer-owned status, terminal, tab, lease, and attempt fields
  when the reducer accepts the transition

The patch changed `shared/js/jobState.js` so `queued -> active` is an allowed
compatibility transition. This keeps the reducer strict for terminal recovery
while allowing old `mbProfileNukeProgress` records to be adopted without
inventing an intermediate event that the service worker never observed.

The patch changed `test/jobState.test.js` so reducer coverage now includes the
legacy queued-to-active progress milestone.

The patch also removed `puppeteer-core` from `package.json` and
`package-lock.json`. A repo scan found no maintained automation code importing
it; remaining `puppeteer` matches are Quora DOM class names such as
`.puppeteer_test_tribe_info_header`, not Puppeteer usage.

## Previous Important Slice: `1.6.208`

The immediate bug under investigation was wrong space-feed top-button state
during large multi-space queue runs. The user saw a top button like
`Nuke 'Em 10` when they expected active work, and later saw deep/reloaded pages
where scan state did not catch up.

The patch changed `shared/js/content.js` so:

- `resolveCurrentSpaceDescriptor()` no longer requires the Quora space header
  DOM to be present; it can identify the current space from the canonical/page
  URL.
- the top space-feed `Nuking... N left` label uses durable pending space-feed
  work rather than only the content script's active/success-filtered view.
- progress-driven refresh and active-mode clearing use the durable pending
  count so a deep scroll or missing header does not incorrectly drop the
  active-space working state.

This made the UI match service-worker pending counts, but it also exposed that
some space pending records can exist when the user does not believe they queued
that space.

## Validation Completed

For `1.6.213`:

- `node --check shared/js/jobState.js`: pass
- `node --check shared/js/sw.js`: pass
- `node --check shared/js/content.js`: pass
- `node --check shared/js/coordinator.js`: pass
- `node --check test/p1-contract.test.js`: pass
- `env npm_config_cache=/tmp/mute-block-npm-cache npm test`: pass
- `git diff --check`: pass
- `env npm_config_cache=/tmp/mute-block-npm-cache npm run prod`: pass
- `env npm_config_cache=/tmp/mute-block-npm-cache npm run build:chrome`: pass
- `env npm_config_cache=/tmp/mute-block-npm-cache npm run build:firefox`: pass

Generated artifacts:

- `chrome/mute_block-1.6.213.zip`
- `firefox/mute_block-1.6.213.zip`

Live CDP/sync validation for `1.6.213`:

- `curl --noproxy '*' --max-time 5 -sS http://127.0.0.1:9223/json/version`: pass
- rsync unpacked Chrome build to Windows: pass
- extension reload through `/tmp/mute-block-cdp-reload-extension.js`: pass

For `1.6.208`:

- `node --check shared/js/content.js`: pass
- `node --check shared/js/sw.js`: pass
- `env npm_config_cache=/tmp/mute-block-npm-cache npm test`: pass
- `env npm_config_cache=/tmp/mute-block-npm-cache npm run prod`: pass
- `env npm_config_cache=/tmp/mute-block-npm-cache npm run build:chrome`: pass
- `env npm_config_cache=/tmp/mute-block-npm-cache npm run build:firefox`: pass
- rsync of unpacked Chrome build to Windows: pass
- extension reload via CDP helper: pass

Live CDP validation after reload:

- Obvious Troll showed `Nuking... 52 left`; worker summary also showed
  `pendingRemaining: 52`.
- Taking out the Trash showed `Nuking... 49 left`; worker summary also showed
  `pendingRemaining: 49`.
- Other visible space tabs with no pending work showed idle `Nuke 'Em N`.

## Current Caution

Stop using the Obvious Troll page as the clean validation target for now.

After `1.6.208`, the user reported:

- Obvious Troll shows `Nuking 52 left` even though they did not think anything
  had been queued there.
- The first card, Jayden Camden, shows `Nuking 1 left`.
- The user then said it looks like some items were queued and to move
  elsewhere.

Do not poke, click, or clear Obvious Troll unless the user explicitly asks. The
important interpretation is not "the label mismatch is fixed"; it is that the
label now reflects durable pending records, and those records may be stale,
cross-run, or otherwise not aligned with the user's intended current work.

## Likely Next Investigation

Use a different, cleaner space/page and verify bookkeeping before queueing:

1. Snapshot service-worker storage for the target space before clicking:
   `mbSpacePendingNukedPosts`, `mbCoordinatorQueue`, `mbCoordinatorRuns`, and
   `mbProfileNukeProgress`.
2. Confirm whether the target space has existing pending work before the top
   button renders.
3. If no work exists, the top button should be idle and per-post buttons should
   show queueable candidates.
4. If durable pending exists but no active run/queue backing exists, fix stale
   pending cleanup instead of relying on the top button to hide it.
5. Revisit whether the top button should display durable pending count,
   queue-backed count, or a blended "work left" count after this is understood.

The highest-probability bug still open: `mbSpacePendingNukedPosts` can retain or
surface pending records that are not backed by user-intended current work. The
display change made that visible rather than solving the underlying state
ownership/cleanup issue.

## Useful Live Commands

Chrome CDP endpoint:

```text
http://127.0.0.1:9223
```

Extension id:

```text
ajcjckiafbnhioeafaejlaehkmdcdeha
```

Check CDP:

```bash
curl --noproxy '*' --max-time 5 -sS http://127.0.0.1:9223/json/version
```

Sync unpacked Chrome build:

```bash
rsync -az --delete -e 'ssh -p 10022 -o BatchMode=yes' chrome/ 'DBROWER-X40-J+DBROWER@127.0.0.1:/cygdrive/c/Users/DBROWER/Documents/src/mute-block-main/chrome/'
```

Reload extension:

```bash
node tools/cdp/reload-extension.js
```

CDP helper dictionary:

- `tools/cdp/README.md`
- `tools/cdp/reload-extension.js`
- `tools/cdp/space-summary.js`
- `tools/cdp/reload-space-tabs.js`
- `tools/cdp/inspect-space-state.js`

These helpers default to the live tunnel on `127.0.0.1:9223` and avoid
Puppeteer. Use the repo copies instead of regenerating matching scripts in
`/tmp`.

## Build Rule Reminder

For any shipped behavior change:

1. bump version in `package.json`, `package-lock.json`,
   `manifests/chrome.json`, and `manifests/firefox.json`
2. run syntax/tests
3. run `npm run prod`
4. run `npm run build:chrome`
5. run `npm run build:firefox`
6. sync/reload Chrome if live validation is needed

Use `env npm_config_cache=/tmp/mute-block-npm-cache` for npm commands in this
environment.

## Current Dirty Tree Snapshot

At handoff time, the repo had many existing modified files from the ongoing
refactor, including:

- `AGENTS.md`
- version files and manifests
- dashboard/coordinator UI files
- `shared/js/content.js`
- `shared/js/sw.js`
- `shared/js/coordinator.js`
- `shared/js/popup.js`
- `shared/js/subject.js`
- `shared/js/jobState.js`
- `test/jobState.test.js`
- planning and inventory notes

Preserve unrelated user/refactor changes.
