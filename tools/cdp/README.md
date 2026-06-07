# CDP Helper Dictionary

Use these helpers for live Windows Chrome validation through the reverse CDP
tunnel. Do not regenerate one-off versions in `/tmp` unless a probe is truly
experimental and not worth preserving.

Defaults:

- CDP endpoint: `127.0.0.1:9223`
- Extension id: `ajcjckiafbnhioeafaejlaehkmdcdeha`
- Override with `--host`, `--port`, `--extension-id`, or the matching
  `MB_CDP_HOST`, `MB_CDP_PORT`, `MB_EXTENSION_ID` environment variables.

## Windows Chrome Profile Launcher

Use `tools/cdp/windows-chrome-profile.js` when a test needs a fresh or
controlled Windows Chrome profile behind Cygwin SSH. It avoids PowerShell and
uses remote `cmd.exe` only.

Launch a new disposable profile on the Windows host:

```bash
node tools/cdp/windows-chrome-profile.js \
  --ssh USER@WINDOWS_HOST \
  --remote-port 9224 \
  --local-port 9224 \
  --new-profile
```

Then keep the CDP tunnel open as a separate command:

```bash
ssh -N -L 9224:127.0.0.1:9224 USER@WINDOWS_HOST
```

Check the local endpoint:

```bash
curl http://127.0.0.1:9224/json/version
```

To reuse an existing Windows profile, pass its user-data-dir:

```bash
node tools/cdp/windows-chrome-profile.js \
  --ssh USER@WINDOWS_HOST \
  --remote-port 9224 \
  --profile-dir 'C:\Users\DBROWER\AppData\Local\Temp\mb-existing-profile'
```

By default, the launcher kills only the listener on the requested remote debug
port before starting Chrome. Add repeated `--kill-port PORT` options to clear
other known debug ports. A new disposable profile needs a fresh Quora login
before authenticated Quora tests can run.

### WINDOWS-HOST Regression Browser

The current Windows laptop setup has two separate tunnels:

- CDP reverse tunnel: local `127.0.0.1:9223` reaches laptop Chrome
  `127.0.0.1:9222`.
- SSH/copy tunnel: local `127.0.0.1:10022` reaches laptop SSH port `22`.

Codex agents have standing permission to use the established tunneled SSH
route for this repo's live-browser workflow. Do not ask again before running
bounded `ssh` or `rsync` commands through `127.0.0.1:10022` to inspect the
Windows regression browser state, clean stale delivery directories, or copy the
rebuilt unpacked extension into the canonical Windows delivery path.

Use the current logged-in debug profile when the regression needs existing
Quora authentication:

```text
C:\Users\DBROWER\AppData\Local\Temp\mb-chrome-debug
```

Use a fresh profile only for clean upgrade/install tests. A fresh profile will
not be logged in to Quora; authenticate it manually before running any
regression phase that needs Quora pages or account state.

Plain SSH launches can create an invisible Windows session-0 Chrome. For a
visible regression browser, launch through the logged-in desktop session. Check
the active console session first:

```bash
ssh -F /home/dbrower/.ssh/config -p 10022 -o BatchMode=yes \
  'WINDOWS-HOST+DBROWER@127.0.0.1' \
  'cmd.exe /d /c query user'
```

The expected visible browser process is in Windows Console session `1`. A
debug-profile Chrome in Services/session `0` is a stale invisible launch and
should not be used for regression.

For the keyed current Chrome build, use a load-only launch. Do not add
`--disable-extensions-except`; in the managed Chrome environment it can hide
the normal extension registry and make Web Store installs report that
installation is not allowed. The known-good pattern is:

1. Write a temporary `.cmd` on the laptop that starts Chrome with:
   - `--user-data-dir=<profile>`
   - `--remote-debugging-address=127.0.0.1`
   - `--remote-debugging-port=9222`
   - `--load-extension=<unpacked chrome build>`
2. Run that `.cmd` via an interactive scheduled task:

```bash
ssh -F /home/dbrower/.ssh/config -p 10022 -o BatchMode=yes \
  'WINDOWS-HOST+DBROWER@127.0.0.1' \
  'cmd.exe /d /c "schtasks /Create /TN MBChromeDebug /SC ONCE /ST 23:59 /TR C:\Users\DBROWER\AppData\Local\Temp\mb-launch-debug.cmd /F /IT && schtasks /Run /TN MBChromeDebug"'
```

Then verify CDP locally:

```bash
curl --noproxy '*' http://127.0.0.1:9223/json/version
```

Command-line `--load-extension` may not register the unpacked Mute Block build
by itself. If `chrome.developerPrivate.getExtensionsInfo()` or `/json/list`
does not show a live service worker for
`chrome-extension://nlmmkoljofpgbmlcojebolmniineboah/`, use the visible browser
UI:

```text
>>>>>> OPERATOR INTERVENTION: do open chrome://extensions, enable Developer mode, click Load unpacked, select C:\Users\DBROWER\Documents\src\mute-block-main\chrome, and report the listed extension ID/version or the exact visible Chrome error text.
```

After manual load, verify that Mute Block is listed with:

- id: `nlmmkoljofpgbmlcojebolmniineboah`
- version: the current repo build
- location: `UNPACKED`
- state: `ENABLED`
- zero manifest/runtime/install warnings or errors

Do not use the `chrome://extensions` Update button to pick up a newer local
build when the unpacked build uses the keyed Chrome Web Store ID. Chrome treats
that ID as store-backed, so Update can load the latest store version instead of
the later unpacked local build. To validate a new local artifact, explicitly
click `Load unpacked` again and select the current unpacked build directory,
then re-check the version and path.

Then run the upgrade regression Phase 5 dashboard authority smoke before
expanding to later browser phases:

```bash
node tools/cdp/upgrade-regression/run.js \
  --extension-id nlmmkoljofpgbmlcojebolmniineboah \
  --profile-label session1-loadonly-manual-loaded-phase5 \
  --phase phase5-dashboard-readonly-authority-smoke
```

### Known-Good Upgrade Regression Sequence

For the keyed Chrome Web Store upgrade profile, the known-good sequence is:

1. Launch visible Windows session-1 Chrome with `--load-extension` only.
2. If command-line load does not register Mute Block, use manual
   `chrome://extensions` Developer mode -> Load unpacked.
3. Verify the post-load extension registry:
   - id: `nlmmkoljofpgbmlcojebolmniineboah`
   - name: `Mute Block`
   - location: `UNPACKED`
   - state: `ENABLED`
   - zero manifest/runtime/install warnings or errors
4. Run Phase 5 dashboard authority.
5. Sign in to Quora if the runner prints the Quora operator prompt.
6. Run Phase 6 authenticated content refresh/reinject.
7. Run Phase 3 profile-search discovery.
8. Run Phase 3 seeded space discovery.
9. Optionally run Phase 4 space-mark UI if mutating `mbSpaceRegistry` is
   acceptable in the warmed profile.
10. Run Phase 7 discovery reload stability.

Successful post-load verification command:

```bash
node tools/cdp/upgrade-regression/run.js \
  --extension-id nlmmkoljofpgbmlcojebolmniineboah \
  --profile-label session1-loadonly-manual-loaded-phase5 \
  --phase phase5-dashboard-readonly-authority-smoke
```

Successful authenticated completion commands:

```bash
node tools/cdp/upgrade-regression/run.js \
  --extension-id nlmmkoljofpgbmlcojebolmniineboah \
  --profile-label session1-loadonly-manual-loaded-phase6-authenticated \
  --phase phase6-stale-content-refresh-reinject-smoke \
  --quora-url https://www.quora.com/
```

```bash
node tools/cdp/upgrade-regression/run.js \
  --extension-id nlmmkoljofpgbmlcojebolmniineboah \
  --profile-label session1-loadonly-manual-loaded-phase3-search-authenticated \
  --phase phase3-search-discovery-smoke
```

```bash
node tools/cdp/upgrade-regression/run.js \
  --extension-id nlmmkoljofpgbmlcojebolmniineboah \
  --profile-label session1-loadonly-manual-loaded-phase3-space-authenticated \
  --phase phase3-space-discovery-smoke
```

```bash
node tools/cdp/upgrade-regression/run.js \
  --extension-id nlmmkoljofpgbmlcojebolmniineboah \
  --profile-label session1-loadonly-manual-loaded-phase7-authenticated \
  --phase phase7-discovery-reload-stability-smoke
```

This sequence is still non-work-starting. It must not create coordinator queue
rows, profile progress rows, WAL keys, queued action-surface records, the full
the deleted full legacy progress blob key, repair/import alarms, or accepted legacy
runtime actions. Queue-authority tests are a separate disposable-profile class.

Work-producing queue-authority sequence after the non-work-starting phases:

```bash
node tools/cdp/upgrade-regression/run.js \
  --extension-id nlmmkoljofpgbmlcojebolmniineboah \
  --phase phase9-small-batch-queue-authority-smoke \
  --search-url 'https://www.quora.com/search?q=barack%20obama&type=profile' \
  --phase9-target-count 3 \
  --allow-work-producing
```

```bash
node tools/cdp/upgrade-regression/run.js \
  --extension-id nlmmkoljofpgbmlcojebolmniineboah \
  --phase phase10-medium-batch-queue-authority-smoke \
  --search-url 'https://www.quora.com/search?q=barack%20obama&type=profile' \
  --phase10-target-count 10 \
  --phase10-concurrency 2 \
  --phase10-timeout-ms 1200000 \
  --phase10-idle-ms 20000 \
  --allow-work-producing
```

Run these only in a disposable or explicitly approved warmed logged-in profile.
They intentionally create WAL-backed queue authority and profile terminal state.

## Dictionary

| Script | Purpose | Typical command |
| --- | --- | --- |
| `tools/cdp/windows-chrome-profile.js` | Stop an existing Windows Chrome/CDP listener on selected debug ports and launch Windows Chrome through Cygwin SSH with either a disposable or existing profile. Prints the separate `ssh -N -L` tunnel command. | `node tools/cdp/windows-chrome-profile.js --ssh USER@WINDOWS_HOST --remote-port 9224 --new-profile` |
| `tools/cdp/reload-extension.js` | Clear/report extension errors and reload only when the install is not Web Store-backed. For the keyed Mute Block ID, use visible `Load unpacked` from `C:\Users\DBROWER\Documents\src\mute-block-main\chrome`; `chrome.developerPrivate.reload` can fall back to the store payload. | `node tools/cdp/reload-extension.js` |
| `tools/cdp/space-summary.js` | Summarize all open Quora space tabs and service-worker space/queue state. | `node tools/cdp/space-summary.js` |
| `tools/cdp/reload-space-tabs.js` | Reload all open Quora space tabs without creating new tabs. | `node tools/cdp/reload-space-tabs.js` |
| `tools/cdp/inspect-space-state.js` | Inspect one space by URL/title substring, including source-page controls, pending post records, queue rows, and worker ownership. | `node tools/cdp/inspect-space-state.js --needle theobvioustrollshootinggallery` |
| `tools/cdp/space-contributors.js` | Inspect, open, or nuke the visible contributor modal for one space tab without switching to profile targets. | `node tools/cdp/space-contributors.js --needle itsoktobewhite --action open-and-nuke` |
| `tools/cdp/queue-summary.js` | Summarize coordinator queue/run state and open profile tabs, optionally filtered by source/target text. | `node tools/cdp/queue-summary.js --needle itsoktobewhite` |
| `tools/cdp/queue-counts.js` | Compact persisted queue counts plus open profile tabs for quick monitoring. | `node tools/cdp/queue-counts.js --needle profile-modal` |
| `tools/cdp/queue-failures.js` | List failed persisted queue rows and their error text for a source/target needle. | `node tools/cdp/queue-failures.js --needle profile-modal` |
| `tools/cdp/inspect-queue-item.js` | Inspect full queue/progress/runtime state for queue rows matching a target/source/error needle. | `node tools/cdp/inspect-queue-item.js --needle Elon-Musk-1641 --limit 1` |
| `tools/cdp/inject-content-script.js` | Inject the packaged content script and CSS into matching live Quora profile tabs from an extension page, without foregrounding the tabs. | `node tools/cdp/inject-content-script.js --needle Elon-Musk-1923` |
| `tools/cdp/queue-storage-summary.js` | Summarize persisted coordinator queue/run state from an extension page when the service worker is asleep. | `node tools/cdp/queue-storage-summary.js --needle profile-modal` |
| `tools/cdp/queue-wakeup-metrics.js` | Summarize persisted queue wakeup/storage metrics from extension storage, or analyze an exported metrics JSON file. | `node tools/cdp/queue-wakeup-metrics.js` |
| `tools/cdp/requeue-failures.js` | Requeue failed persisted queue rows matching a needle through the extension service worker. | `node tools/cdp/requeue-failures.js --needle profile-modal --max-concurrent 1` |
| `tools/cdp/target-summary.js` | Summarize open CDP targets without evaluating page or worker JavaScript. Useful when the page or service worker is busy. | `node tools/cdp/target-summary.js` |
| `tools/cdp/close-profile-tabs.js` | Close open Quora profile page targets, optionally filtered by URL/title text. | `node tools/cdp/close-profile-tabs.js` |
| `tools/cdp/requeue-stale-active.js` | Requeue persisted active rows for a needle only when no live Quora profile tabs are open. Useful after a service-worker restart strands active rows. | `node tools/cdp/requeue-stale-active.js --needle profile-modal` |
| `tools/cdp/open-queued-storage-tabs.js` | Open a small batch of persisted queued rows as inactive profile tabs from an extension page, bypassing an asleep queue pump while preserving the durable claim path. | `node tools/cdp/open-queued-storage-tabs.js --needle profile-modal --limit 1` |
| `tools/cdp/resume-queue.js` | Ask the extension service worker to resume persisted coordinator queue work, unpausing first when Current Work is paused. | `node tools/cdp/resume-queue.js` |

Keep live UI driving on raw CDP. Puppeteer is intentionally not part of this
tool directory.
