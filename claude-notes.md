# Claude Working Notes

Session-local orientation notes for the workflow-mode change (2026-08-25).
Not a canonical project doc; see planning.md / architecture.md for those.

## What this project is

`Mute Block` — a Chrome/Firefox browser extension (WebExtension) that lets a
Quora user mute/block profiles and manage "spaces". Currently on the private
`1.6` stabilization line, targeting a public `2.0` release. Core architecture
is a service-worker-owned durable queue (WAL + checkpoints) reconciled against
live browser tab observations; see `architecture.md` and `planning.md` as the
canonical front doors.

## Repo state observed

- `~/src/mute-block-main`, branch `main`, 124 commits ahead of `origin/main`
  (not pushed).
- Working tree has many untracked files: loose root-level debug scripts
  (`mute-block-cdp-*.js`, `mute-block-backlog-classify.js`), a few stray notes
  (`review-1.md`, `housekeeping.md`, `consul-investigation-session.md`), and a
  large `tmp/` directory of historical live-debug logs/JSON captures. Nothing
  committed yet from these — treat as prior-session scratch/history, not
  something to clean up unprompted.
- `npm test` entry point runs a fixed list of `test/*.test.js` files (unit +
  fuzz + synthetic scenario tests). No live browser needed for these.

## Old workflow (being replaced)

The docs (AGENTS.md, tools/cdp/README.md) describe a setup where the coding
agent ran on a sandboxed/corporate host that could not run a real browser or
reach real Quora. Live validation instead happened on a separate Windows
laptop (`DBROWER-X40-J`), reached over two SSH tunnels:

- CDP reverse tunnel: local `127.0.0.1:9223` -> Windows Chrome
  `127.0.0.1:9222`.
- SSH/copy tunnel: local `127.0.0.1:10022` -> Windows SSH port 22, used by
  `rsync`/`scp` to push the unpacked build over (`tools/cdp/sync-windows-build.js`,
  `reload-windows-extension.js`, `reset-windows-tabs.js`, `windows-chrome-profile.js`).
- Root-level `browser-control-tunnel`, `reverse-copy-tunnel`, `tunnels` scripts
  set these up; `tools/cdp/lib/cdp.js` defaults to port `9223` (the tunneled
  port), not a real local Chrome debug port.
- Firefox side has a comparable local BiDi harness (`tools/firefox-bidi/`)
  plus a `tools/mock-quora/` fixture server, used because "real Quora is not
  expected to be useful on the corporate VM."

**User confirmed (2026-08-25): no tunnel scripts are needed in this new
mode.** Source and browser both run locally on this machine now.

## New mode of work (this machine)

- `google-chrome` (151.0.7922.137) and `firefox` (153.0.3) are both installed
  locally and presumably can reach real Quora directly — no Windows laptop,
  no SSH tunnel required.
- `chrome-config.cjs` currently points `run.chromiumBinary` at a **Mac** path
  (`/Applications/Google Chrome.app/...`) — stale from a different prior dev
  machine, not usable here as-is.
- `firefox-config.cjs` runs `firefox: 'deved'` (a named/dev channel), also
  worth checking against what's actually available locally.
- The Windows-tunnel CDP tooling (`sync-windows-build.js`, `reload-windows-extension.js`,
  `reset-windows-tabs.js`, `windows-chrome-profile.js`, default port 9223) is
  the main thing that needs a local-first replacement/rework, since it assumes
  a remote target reached over rsync+tunnel rather than "launch Chrome right
  here and point CDP at it directly."

## Answers received (2026-08-25)

- Real Quora is reachable directly from this machine — no mock-quora needed
  as the primary path.
- Old Windows/tunnel tooling: remove/replace now (done, see below).
- First task: stand up the local browser workflow end to end.

## Local-only workflow migration (done 2026-08-25)

Removed (no longer needed once browser + source are both local):

- `browser-control-tunnel`, `reverse-copy-tunnel`, `tunnels`, `rcopy` (root)
- `tools/cdp/windows-chrome-profile.js`, `tools/cdp/start-windows-debug-browser.js`,
  `tools/cdp/sync-windows-build.js`
- the "Windows Live-Browser Copy Preference" section of `AGENTS.md`
- the "Windows Chrome Profile Launcher" / "DBROWER-X40-J Regression Browser"
  sections of `tools/cdp/README.md`

Renamed/repointed at localhost instead of the tunnel:

- `tools/cdp/reload-windows-extension.js` -> `tools/cdp/reload-chrome-dev.js`
- `tools/cdp/reset-windows-tabs.js` -> `tools/cdp/reset-chrome-dev-tabs.js`
- `tools/cdp/lib/cdp.js`: default CDP port `9223` -> `9222`; `DEFAULT_REMOTE_CHROME_DEV_PATH`
  (a Windows path) -> `DEFAULT_CHROME_DEV_PATH` (local `<repo>/chrome-dev`)
- same port/path renames propagated into `tools/cdp/clear-coordinator-test-state.js`
  and `tools/cdp/upgrade-regression/run.js`
- `tools/cdp/live-test-loop.js`: dropped the sync-to-Windows step entirely
- `package.json`: dropped `sync:chrome-dev`, added `launch:chrome-dev`,
  repointed `reload:chrome-dev` / `reset:chrome-dev-tabs` at the renamed scripts
- `chrome-config.cjs` / `firefox-config.cjs`: fixed stale binary paths
  (was a macOS Chrome path and Firefox `deved` channel; now `/usr/bin/google-chrome`
  and `/usr/bin/firefox`)

Added: `tools/cdp/launch-local-chrome.sh` — launches local `google-chrome`
with a dedicated `--user-data-dir`, the unpacked `chrome-dev` extension, and
`--remote-debugging-port=9222`. Mirrors the existing
`tools/firefox-bidi/launch-dedicated-firefox.sh` pattern. Wired up as
`npm run launch:chrome-dev`.

`tools/cdp/README.md` rewritten for the local-only workflow (new "Local
Chrome Launch" section, updated Dictionary table, no more tunnel/SSH steps).

**Left untouched on purpose:** all the dated/historical `*.md` notes
(handoffs, retrospectives, plans) that mention the old Windows/tunnel setup —
per `planning.md`'s own rule, those are timestamped snapshots, not live docs,
and editing them would falsify history. Only the canonical/live docs
(AGENTS.md, tools/cdp/README.md) were updated.

## Display gotcha on this machine

The shell's inherited `DISPLAY` (`:7`) is stale and doesn't correspond to a
running X server. The user's actual GNOME/Wayland session serves X11 clients
via Xwayland on `:0`, with a per-login `XAUTHORITY` file at
`/run/user/1000/.mutter-Xwaylandauth.<suffix>` (find the current suffix with
`ls /run/user/1000/ | grep Xwaylandauth`). GUI app launches (Chrome, Firefox)
need `DISPLAY=:0`, that `XAUTHORITY`, `WAYLAND_DISPLAY=wayland-0`, and
`XDG_RUNTIME_DIR=/run/user/1000` set explicitly. Saved as a standing memory.

## Local Chrome launch: `--load-extension` gotcha

Launched `npm run launch:chrome-dev` successfully (CDP live on
`127.0.0.1:9222`, confirmed via `chrome://version`'s Command Line field that
`--load-extension=.../chrome-dev` was passed correctly) — but Chrome 151
silently did not load the extension anyway (`chrome://extensions` only shows
the stock "Google Docs Offline" extension; no service worker target for Mute
Block). This matches a caveat already documented in `tools/cdp/README.md`
from the old Windows setup ("Command-line `--load-extension` may not register
the unpacked Mute Block build by itself") — so it's a known Chrome behavior,
not specific to this migration. No managed enterprise policy files were found
under `/etc/opt/chrome/policies/managed/`, so it isn't a corporate policy
lockdown on this machine either.

Fallback (same as the documented Chrome Web Store keyed-build workaround):
manually open `chrome://extensions` (already open in the launched window),
enable Developer mode, click `Load unpacked`, and select
`/home/dbrower/src/mute-block-main/chrome-dev`. This step needs a human — CDP
can't drive the native OS folder picker.

## STATUS AS OF END OF SESSION (2026-08-25) — local browser standup blocked on display/session confusion, not yet working

Chain of findings, in order:

1. Native file-picker dialogs (GTK/`xdg-desktop-portal`) never appear for
   *any* process Claude Code launches on this machine, sandboxed or not
   (`dangerouslyDisableSandbox: true` made no difference — confirmed with a
   minimal `zenity --file-selection` repro, which fails identically both
   ways with `Portal operation not allowed: Unable to open /proc/<pid>/root`).
   This rules out doing "Load unpacked" (or any native-picker-driven flow)
   from a Claude-launched process at all. Saved as memory
   `no-native-file-dialogs-from-claude-code`.
2. Below that, we hit a second, separate problem: this machine has **more
   than one live GUI session at once** — at least a console session and a
   systemd-managed VNC session, seen at various points as display `:0`
   (a GNOME/Wayland session found via `ps aux`, turned out irrelevant),
   `:1` (what the user's own terminal shell reported, but even `xterm`
   would not open there — so likely stale/wrong for that shell too), and
   `:7` (a systemd VNC session, and notably the same value the Bash tool's
   *own* inherited shell environment started with at the very beginning of
   this session). The user confirmed they are physically at the console
   monitor, not VNC — but even so, `DISPLAY=:1` reported by their own
   terminal did not yield a working `xterm`. This was not resolved before
   the session ended. Corrected memory `dbrower-workstation-display` to stop
   asserting any specific display and instead say: never guess, always
   confirm against the user's actual live session.

**Next session should start by**: getting the user to identify, from a
terminal window they trust is genuinely attached to their visible console
(e.g. freshly opened from the desktop's own application menu, not an old
tab/pane), a `DISPLAY` value where a trivial `xterm`/`xclock` actually shows
up on their screen. Only once that's established should
`tools/cdp/launch-local-chrome.sh` be retried (it already trusts the
environment rather than guessing, and force-selects `--ozone-platform=x11`
when only `DISPLAY` is set). Once a visible Chrome window is achieved, the
`Load unpacked` step still needs to be done by the user manually (see
finding 1 above) — that part is expected to work fine once we're pointed at
a real, visible session, since portal/file-dialog behavior for a normal
user-launched GUI app on a working desktop session is not expected to have
the same problem as Claude-Code-launched processes.

**Also still running in background from this session, unattended:** `npm
test` (started via `cd ~/src/mute-block-main && npm test > <scratchpad>/npm-test.log 2>&1 &`,
pid 946248/946267 tree). All `ok` lines seen so far, no failures; the swFuzz
tests are just slow. Worth checking the tail of that log at the start of the
next session rather than re-running from scratch.
