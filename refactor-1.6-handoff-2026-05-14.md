# Refactor 1.6 Handoff - 2026-05-14

Status: historical handoff.

Canonical planning now starts at [planning.md](planning.md). Canonical
architecture starts at [architecture.md](architecture.md). Use this only to
recover the May 14 context; it is superseded for current priorities.

## Scope

Continue the `1.6` refactor/stabilization work in this normal Git repo:

- remove old compatibility/legacy behavior as queue authority
- keep durable service-worker queue state authoritative
- get fixed-set block/reverse repeatability stable without manual resume
- do not ask for repo-local edit permission; files in this tree are writable

This is not an ADE workspace.

## Current Version and Artifacts

Latest source/package version: `1.6.154`.

Built artifacts exist:

- `chrome/mute_block-1.6.154.zip`
- `firefox/mute_block-1.6.154.zip`

Chrome on the Windows laptop was copied and reloaded to `1.6.154`.
Extension manager reported:

- `runtimeErrors: []`
- `runtimeWarnings: []`
- `manifestErrors: []`

After reload, a fresh coordinator page was opened. The service-worker control
plane responded after a hard coordinator close/reopen cycle.

## Files Touched in the Latest Slice

Primary latest-slice files:

- `shared/js/content.js`
- `shared/js/sw.js`
- `package.json`
- `package-lock.json`
- `manifests/chrome.json`
- `manifests/firefox.json`
- `top-level-rethink-1.5-execution-plan.md`

The repo was already intentionally dirty with broader refactor files. Do not
revert unrelated changes.

## Important Commands

Local validation:

```bash
node -c shared/js/content.js
node -c shared/js/sw.js
git diff --check
env npm_config_cache=/scratch/dbrower/.npm-cache npm test
env npm_config_cache=/scratch/dbrower/.npm-cache npm run prod
env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:chrome
env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:firefox
```

Windows Chrome copy:

```bash
timeout 60 rsync -az --delete -e 'ssh -p 10022 -o BatchMode=yes' chrome/ 'DBROWER-X40-J+DBROWER@127.0.0.1:/cygdrive/c/Users/DBROWER/Documents/src/mute-block-main/chrome/'
```

Chrome CDP endpoint:

```text
http://127.0.0.1:9223
```

Extension id:

```text
ajcjckiafbnhioeafaejlaehkmdcdeha
```

## Fixed Profile Set

Use exactly this set for fixed block/reverse repeatability:

- `https://www.quora.com/profile/Benny-Johnsn`
- `https://www.quora.com/profile/Dom-Grayson-1`
- `https://www.quora.com/profile/Fredrick-Smith-169`
- `https://www.quora.com/profile/Klaus-Schadenfreude-1`
- `https://www.quora.com/profile/Nick-Greene-76`
- `https://www.quora.com/profile/Robert-Bradley-14`
- `https://www.quora.com/profile/Shannon-Torrence-5-1`
- `https://www.quora.com/profile/Warren-Zike`

## Recent Changes

### `1.6.151`

Changed content-side durable action-gate handling:

- after `begin-profile-action` local timeout, probes the durable lease via
  `heartbeat-action-lease`
- once a lease is confirmed, keeps heartbeating while profile actions become
  ready
- avoids the old hard 15s foreground readiness failure

Result:

- Fixed block pass `manual-16151-block-1778771365581` completed `8/8`.
- Reverse pass `manual-16151-reverse-1778771773148` did not finish in 11
  minutes: `5 succeeded`, `2 active`, `1 queued`.

### `1.6.152`

Changed service-worker terminal cleanup:

- terminal coordinator rows now close the recorded worker tab id directly
- releases queued-tab state before cleanup

Reason:

- reverse rows could become durable-terminal while their profile tab stayed
  open and continued to block the foreground/action lane

### `1.6.153`

Changed content-side recovery again:

- if `begin-profile-action` times out but the same-attempt progress mirror has
  fresh foreground promotion for the requested action, content treats the
  durable action gate as begun
- heartbeat probe timeout was extended on that path

Result:

- Clean fixed block baseline `manual-16153-block-1778773557351` completed
  `8/8 succeeded`, run `complete`, matching queue/progress attempt ids, zero
  fixed-profile tabs left open.
- Reverse `manual-16153-reverse-1778773916913` still failed at 11 minutes:
  `4 succeeded`, `2 failed`, `1 active`, `1 queued`.

Important row details from that failed reverse:

- `Benny-Johnsn`: `failed/action-error`
  - error: `Queued Unblock Unmute did not receive profile action gate: timed-out-waiting`
  - progress stayed in foreground wait with `begin-profile-action-timeout`
  - old progress mirror still had `mute-block-profile-menu-action`
    foreground-promotion fields from the previous block attempt, not fresh
    reverse promotion fields
- `Shannon-Torrence-5-1`: `failed/timeout`
  - error: `Queued tab timed out after disappearing before completion`
  - progress mirror showed stale block events mixed into the reverse attempt
- `Nick-Greene-76`: still `active/unblocking`
  - good signal: events included
    `Queued tab recovered durable profile action gate after begin timeout`
  - this proves the `1.6.153` recovery path works for at least one reverse row
- `Warren-Zike`: still `queued`
  - queue attempt was reverse, but progress mirror remained old block
    `already-blocked`

### `1.6.154`

Changed content-side gate timeout:

- raised `ACTION_LEASE_WAIT_MS` from `90000` to `240000`

Reason:

- Benny's `1.6.153` reverse failure was still a bounded foreground-gate wait
  expiring while the scheduler was otherwise active.

This is a tactical stabilization change, not the final architecture.

## Validation Completed

For `1.6.154`:

- `node -c shared/js/content.js`: pass
- `node -c shared/js/sw.js`: pass
- `git diff --check`: pass
- `npm test`: pass
- `npm run prod`: pass
- `npm run build:chrome`: pass
- `npm run build:firefox`: pass
- Chrome copy to Windows: pass
- Chrome reload to `1.6.154`: pass, no extension-manager errors/warnings

No full `1.6.154` fixed reverse run was completed before stopping.

## Current Diagnosis

The stale terminal-progress corruption that originally caused rows to revert or
prune fresh attempts is much improved. The current blocker is narrower:

1. Reverse reset/progress mirror delivery is not reliably fresh before
   execution. Some reverse queue rows run while `mbProfileNukeProgress` still
   contains previous block attempt data.
2. Foreground/action work still allows multiple active tabs to wait behind one
   foreground lease. That makes reverse actions slow and can still produce
   gate-timeout or disappearing-tab failures.
3. `ACTION_LEASE_WAIT_MS = 240000` in `1.6.154` may reduce false failures, but
   it is not the correct final fix. The final fix should make reverse execution
   scheduler-owned and serialize foreground action work explicitly.

## Recommended Next Slice

Do this before another long live matrix:

1. Make reset enqueue write the compatibility progress mirror for all reset
   action kinds, not only explicit reset/unblock paths after execution setup.
2. Ensure the progress mirror action kind/attempt is fresh before
   `enqueueExistingExecutorForCoordinator()` opens worker tabs.
3. For service-worker-owned `unblock-unmute`, consider enforcing
   `maxConcurrent: 1` or foreground-lane serialization at the scheduler level
   until a real foreground action queue exists.
4. Add a small unit test or helper-level test around reset progress mirror
   replacement if practical.
5. Bump version before rebuild, then run full build/package again.
6. Reload Chrome, hard-close/reopen coordinator, verify
   `get-owned-nuke-status` responds before live tests.
7. Run fixed block first, then fixed reverse.

## Operational Notes

- Always run `skills-book` first.
- This repo is writable without more permission prompts.
- Before any release-oriented build, bump:
  - `package.json`
  - `package-lock.json`
  - `manifests/chrome.json`
  - `manifests/firefox.json`
- If Chrome runtime messages from coordinator time out after reload:
  - close coordinator page via CDP
  - reload extension through `chrome.developerPrivate.reload`
  - reopen coordinator
  - verify `get-owned-nuke-status` responds before enqueueing
