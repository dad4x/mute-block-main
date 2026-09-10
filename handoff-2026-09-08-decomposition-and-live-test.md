# Handoff — 2026-09-08

Moving to a Windows machine with more memory. This covers: what got done this
session, exactly what's uncommitted and why, an unresolved live-testing
finding that needs to be picked back up, and a near-miss (system paging
thrashing) worth learning from before the next live-testing pass.

## 1. What this session did (all committed, all verified)

Continued the `sw.js` decomposition. Full detail lives in
[sw-state-machine-decomposition-plan-2026-09-01.md](sw-state-machine-decomposition-plan-2026-09-01.md);
this is just the session summary.

- **Part 2 priority target #4** (`resumeCoordinatorQueueExecutionOnce`):
  Slices P2-18 through P2-21, 6 `decide*` functions extracted. Commits
  `88ce511`..`63481a0`.
- **Part 2.5** (new): now that Phase 0 (the test-harness realm-boundary fix,
  done earlier this session) removed the constraint keeping `decide*`
  functions resident in `sw.js`, moved all ~29 accumulated `decide*`
  functions out into 4 real modules, matching every other Part 1 extraction's
  shape:
  - `shared/js/swQueuedTabActiveTransitionDecisions.js` (5 fns) — `bde23f2`
  - `shared/js/swFastExecutorDecisions.js` (5 fns) — `70afe42`
  - `shared/js/swResumeQueueExecutionDecisions.js` (7 fns) — `3aa90c7`
  - `shared/js/swFillQueuedTabsOnceDecisions.js` (12 fns) — `bdafe0c`

  Each was doled out to a sub-agent, then **independently re-verified by
  me**: diffed every moved function body against the pre-move source
  (byte-identical except one deliberate, documented exception below), and
  independently re-derived the TDZ/construction-order check for every
  injected dependency rather than trusting the agent's report.

  Two things worth knowing if you touch these modules:
  - **`swResumeQueueExecutionDecisions.js`** needed its construction call
    moved later in `sw.js` (after `swSchedulerAlarmBookkeeping`'s
    destructure) — two dependencies weren't available as bare consts at the
    functions' original resident position. Real TDZ hazard, correctly
    caught.
  - **`swFillQueuedTabsOnceDecisions.js`** is **not** a pure textual move.
    `queuedTabFillOpeningActionKeys` is a `let` `sw.js` reassigns to a fresh
    `Set` on every fill cycle; a one-time destructure would've frozen the
    module onto a stale `Set`. It's threaded as a `deps.state` getter
    closure instead (`getQueuedTabFillOpeningActionKeys`), matching an
    existing accessor pattern already used elsewhere in `sw.js`
    (`queuedTabFillPromise`'s own getter in `storageIdlePromiseLatch`'s
    construction call).

  `sw.js` is now **30,229 lines**, down from 38,953 at the start of this
  whole multi-session effort, with **zero** `decide*` function definitions
  left resident in it.

- **Code review**: reviewed all 95 files under `shared/js/` + `test/`
  (~28,700 lines) via 5 parallel review passes, each independently verifying
  its own findings before reporting. Two real findings, both fixed:
  - `shared/js/spaceRegistry.js:33` (`6740910`) — `normalizeSpaceUrl` had no
    URL scheme allowlist; a `javascript://payload`-shaped URL could survive
    normalization intact and later render as a raw `<a href>` in
    `popup.js`'s space list. Now rejects anything but `https:`. Verified
    directly via `node -e` (legit Quora URLs pass through unchanged;
    `javascript:`/`data:`/plain-`http:` all rejected) plus the full suite.
  - `shared/js/swBootstrap.js:167-176` (`8c6df5b`) — an `if/else` on
    `hasBrowserSessionStorage()` where both branches registered the
    identical `onStartup` listener. Collapsed to one unconditional call,
    removed the now-unused dependency wiring. Fixed two `p1-contract.test.js`
    assertions that depended on the removed conditional's exact source text.

  Everything above: full `npm run test:parallel` green (2-3x each slice),
  both production builds (`npx mix --production`, `node tools/build-chrome-dev.js`)
  green each time.

**Baseline `git status --short` dirty-file count for this repo is ~438**
(scratch logs, session notes, `tmp/*.log`, and a handful of harmless
1-line build-artifact diffs that regenerate on every `npx mix --production`
run). That count predates this session. Never `git add -A` in this repo —
always an explicit pathspec — and check the count returns to baseline after
each commit.

## 2. Uncommitted right now — needs a decision, not mine to make unilaterally

`package.json`, `package-lock.json`, `manifests/chrome.json`,
`manifests/firefox.json` are all modified in the working tree and
**deliberately left uncommitted**. Two different things are tangled together
in `package.json` specifically:

1. **Pre-existing, not mine**: an in-progress rename of the CDP tooling away
   from a Windows-tunnel model to a local-Chrome model (`sync:chrome-dev` /
   `reload-windows-extension.js` / `reset-windows-tabs.js` →
   `launch:chrome-dev` / `reload-chrome-dev.js` / `reset-chrome-dev-tabs.js`).
   This predates this session (it was already in the working tree at the
   very start). **It's not obviously unfinished** — the renamed files exist,
   and I used `npm run launch:chrome-dev` / `npm run reload:chrome-dev` /
   `npm run reset:chrome-dev-tabs` successfully multiple times this session
   via the new names — but I don't know if it's considered done or if
   there's more to it, and it isn't my work to decide to commit.
2. **Mine**: a version bump `1.6.1211` → `1.6.1212` across `package.json`,
   `package-lock.json` (2 fields), `manifests/chrome.json`,
   `manifests/firefox.json`, done because the user pointed out mid-session
   that the build number wasn't incrementing across rebuild/reload cycles
   during live testing ("we still have 1211"). Rebuilt and reloaded into
   the (now-killed) local Chrome afterward; confirmed the running extension
   picked up 1212 with `node tools/cdp/extension-info.js`.

Since these are two different hunks in the same files, splitting them
cleanly needs `git add -p` (interactive) or a hand-built patch, not a
straight `git add <path>`. I left it alone rather than either (a) silently
committing someone else's unrelated in-progress rename or (b) discarding
it. **Next session: decide whether the tooling rename is done and should
land, then decide separately whether to commit the version bump** (it's a
fine change on its own — just bump the number again if a live-testing pass
happens before it's committed, since the built `chrome-dev/manifest.json`
currently says 1212 but the committed `package.json` still says 1211).

## 3. Live testing — started, hit a real finding, then had to stop cold

The user asked to fire up local Chrome with the dev extension and CDP to
manually verify the two review fixes. Full workflow (all in
[tools/cdp/README.md](tools/cdp/README.md)):

```bash
npm run prod && npm run build:chrome-dev
npm run launch:chrome-dev          # starts Chrome, --user-data-dir at
                                    # ~/.local/share/mute-block-chrome-dev-profile,
                                    # CDP on 127.0.0.1:9222
node tools/cdp/extension-info.js --extension-id auto
npm run reload:chrome-dev          # after any further rebuild
```

That profile is **persistent** and already has a Quora login from earlier
sessions. It also, as of this session, had a large number of leftover tabs
from earlier manual testing (~24 tabs across 2 windows — troll/spam-Space
moderation-testing pages, each dragging in Stripe + Cloudflare Turnstile
iframes). That tab pile is almost certainly what caused the crisis in
section 4 below — **clean out excess tabs in that profile before the next
live pass**, or start it fresh (`MB_CHROME_PROFILE=<new path>
npm run launch:chrome-dev`).

### Unresolved finding: the popup's "open dashboard" button appeared to do nothing

The user clicked the popup's control-panel/dashboard button in the live
window and saw no dashboard tab appear in either open Chrome window. I
traced this via CDP before the session had to stop:

- The message flow works: popup sends `{action: 'open-coordinator', active:
  true}`, `swBootstrap.js`'s `onMessage` handler (line ~499, confirmed
  intact and unrelated to this session's `swBootstrap.js` edit) correctly
  routes it to `sw.js`'s `openCoordinatorPage`/`openCoordinatorPageOnce`
  (`sw.js:9441`/`9633`), which returned `{tabId: 253895699, windowId:
  253895698, reused: true}` — no error.
- `chrome.tabs.get()` on that tab ID confirmed it's real, `active: true`,
  `highlighted: true`, inside a real window (`253895698`) that is a
  *second, separate* Chrome window from the one with the visible Quora
  tabs (`253894604`).
- `chrome.windows.getAll()` showed **both** windows reporting
  `focused: false` at the time.
- `maybeActivateCoordinatorTab` (`sw.js:9680`) does call
  `browser.windows.update(windowId, {focused: true})` to bring the
  dashboard's window forward — **but wraps it in a silent
  `.catch(() => {})`**. If that call fails or gets refused, nothing
  surfaces the failure anywhere.

**Working hypothesis, not confirmed**: this machine's desktop is Wayland
(`WAYLAND_DISPLAY=wayland-0`), and Wayland compositors are often stricter
than X11 about letting a background/automation-launched process steal
window focus on demand. If `windows.update({focused: true})` is being
silently refused by the compositor, the dashboard tab would exist, be
"active" within its own window, and just never visibly come to the front —
matching exactly what the user saw. This may or may not reproduce on
Windows; worth testing fresh there, since Windows has its own (different)
foreground-window-stealing prevention rules.

**Not yet done, pick this back up first:**
- Confirm on the new machine whether the same thing happens.
- If it does reproduce, the fix is probably to stop silently swallowing the
  `windows.update` failure in `maybeActivateCoordinatorTab` and either
  retry, fall back to some other focus mechanism, or at minimum surface it
  (a flight-recorder event, a console log) so it's diagnosable without a
  CDP deep-dive next time.
- If it does *not* reproduce on Windows, that's decent evidence it really is
  a Linux/Wayland-specific quirk of this launch method rather than a real
  product bug, and it's probably fine to just note it in
  `tools/cdp/README.md` as a known quirk of this launch script rather than
  chase it further.
- The two code-review fixes (`spaceRegistry.js`, `swBootstrap.js`) never
  got their live-UI click-through verification finished because of this
  detour plus the memory crisis. `swBootstrap.js`'s fix is adequately
  covered already (clean SW startup, zero runtime errors, confirmed twice
  after reload). `spaceRegistry.js`'s fix has solid *logic* verification
  (`node -e` directly against `normalizeSpaceUrl`, full suite) but never
  got the actual "click a Space category button, check the popup's
  rendered link" walkthrough — worth finishing that on the new machine
  since it's the one with a real product-facing UI change.

## 4. Near-miss: system went into paging thrashing

While chasing the dashboard-focus investigation, cumulative CDP activity
(the pre-existing ~24-tab pile plus a few more tabs I opened) pushed the
machine into swap thrashing badly enough that the user said "we can't do
much." I killed the whole launched Chrome process
(`kill -TERM <launcher pid>`) rather than trying to close tabs one-by-one
through an unresponsive CDP connection — that was the right call: memory
went from thrashing to 3.8Gi free / 4.8Gi available within a few seconds,
no orphaned renderer processes left behind (checked via `pgrep -af
google-chrome`, only unrelated crash-handler daemons for the user's normal
profile remained).

**Lesson for next time, especially relevant moving to a new machine cold**:
even a "more memory" machine can thrash if a persistent CDP test profile is
allowed to accumulate dozens of heavy tabs across sessions. Before a live
pass: check `curl -sS http://127.0.0.1:9222/json/list | jq length` (or the
Python one-liner used this session) for tab count before assuming a fresh
launch is lightweight, and proactively close/reset stale tabs
(`npm run reset:chrome-dev-tabs`) rather than layering more on top.

## 5. Straightforward next steps, in rough priority order

1. Resolve the uncommitted `package.json`/manifests state (section 2).
2. Resume live testing on the new machine: launch fresh (clean tab count),
   re-verify the dashboard-open/window-focus finding (section 3), finish
   the `spaceRegistry.js` fix's UI click-through.
3. Otherwise, `sw.js` decomposition Part 2 priority target #5
   (`sweepStaleQueuedTabs`, ~227 lines) is next on the "Next 20 Part 2
   targets" list in the plan doc, whenever that's picked back up — same
   established slice-by-slice workflow (map into the plan doc, extract,
   verify full suite + both builds, commit, repeat).
