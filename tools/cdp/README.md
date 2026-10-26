# CDP Helper Dictionary

Use these helpers for live Chrome validation against a Chrome instance running
directly on this machine, over its local remote-debugging port. There is no
tunnel and no separate regression host in this mode: source, browser, and
CDP endpoint are all local. Do not regenerate one-off versions in `/tmp`
unless a probe is truly experimental and not worth preserving.

The forward-going list, with the reason each helper stays and the helpers retired on 24 Oct 2026, is in [INVENTORY.md](INVENTORY.md).

Defaults:

- CDP endpoint: `127.0.0.1:9222`
- Extension id: use `--extension-id auto` for normal live iteration.
- Dev unpacked path: `<repo>/chrome-dev`
- Manual shell CDP probes: `curl -sS http://127.0.0.1:9222/json/version`. The
  Node CDP helpers use direct `http` calls.
- Override with `--host`, `--port`, `--extension-id`, `--extension-path`,
  `--extension-version`, or the matching `MB_CDP_HOST`, `MB_CDP_PORT`,
  `MB_EXTENSION_ID`, `MB_EXTENSION_PATH`, `MB_EXTENSION_VERSION` environment
  variables.

## Local Chrome Launch

Build the dev unpacked extension, then launch a local Chrome instance with it
loaded and CDP listening on `127.0.0.1:9222`:

```bash
npm run prod
npm run build:chrome-dev
npm run launch:chrome-dev
```

`tools/cdp/launch-local-chrome.sh` starts `google-chrome` with a dedicated
`--user-data-dir` (so it doesn't disturb your normal logged-in Chrome profile
or another debug cycle), `--load-extension=chrome-dev`, and
`--remote-debugging-port=9222`. It is persistent by default
(`~/.local/share/mute-block-chrome-dev-profile`); override with `MB_CHROME_PROFILE`,
`MB_CDP_PORT`, `MB_CHROME_BIN`, or `MB_EXTENSION_PATH`. A fresh profile needs a
one-time manual Quora login before authenticated regression phases can run.

Leave that Chrome instance running in its own terminal/background job; drive
it from the CDP helpers below in separate commands.

## Dev-Unpacked Live Loop

Normal Phase 8/9/10 debugging should use the dev unpacked extension, not the
store-keyed `nlmmkoljofpgbmlcojebolmniineboah` ID. The dev output is generated
from `chrome/` with the manifest `key` stripped, so Chrome assigns a separate
unpacked extension ID that can be discovered and reloaded by path/version.

Reload and discovery are scripted once Chrome is running with `chrome-dev`
loaded (see Local Chrome Launch above):

```bash
npm run reload:chrome-dev
node tools/cdp/extension-info.js --extension-id auto
```

Reset browser tabs before a live phase:

```bash
npm run reset:chrome-dev-tabs
```

The reset keeps `chrome://extensions/` and an already-open Mute Block dashboard
for the discovered dev extension, then closes search/profile/other page tabs. It
does not create the dashboard; if the dashboard is missing, the command reports
that as a failed precondition instead of silently opening one.

Run Phase 10 against the discovered dev ID:

```bash
node tools/cdp/upgrade-regression/run.js \
  --extension-id auto \
  --phase phase10-medium-batch-queue-authority-smoke \
  --search-url 'https://www.quora.com/search?q=barack%20obama&type=profile' \
  --phase10-target-count 8 \
  --phase10-concurrency 2 \
  --phase10-timeout-ms 1200000 \
  --phase10-idle-ms 20000 \
  --allow-work-producing
```

Or run the build/reload/phase sequence as one repo-local helper (Chrome must
already be running with `chrome-dev` loaded):

```bash
node tools/cdp/live-test-loop.js \
  --phase phase10-medium-batch-queue-authority-smoke \
  --phase-args "--search-url=https://www.quora.com/search?q=barack%20obama&type=profile --phase10-target-count=8 --phase10-concurrency=2 --phase10-timeout-ms=1200000 --phase10-idle-ms=20000" \
  --allow-work-producing
```

Use the keyed store ID only for explicit store/distribution upgrade tests.

## Keyed Store-Build Upgrade Testing

Testing the keyed Chrome Web Store extension id
(`nlmmkoljofpgbmlcojebolmniineboah`) instead of the dev-unpacked id needs a
manually loaded `chrome/` build, since that id is store-registered and
`chrome://extensions` Update can silently replace it with the latest published
store version instead of your local build. Launch Chrome (see Local Chrome
Launch above, pointing `MB_EXTENSION_PATH` at `chrome/` if you want the
launcher to preload it), then in the visible browser:

1. Open `chrome://extensions`, enable Developer mode.
2. Click `Load unpacked`, select the repo's `chrome/` directory.
3. Verify Mute Block is listed with:

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

1. Launch local Chrome with `--load-extension` only.
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

## Command Shapes Without Permission Prompts

Keep live-regression and edit-loop commands in simple approved forms. Do not use inline heredocs, ad hoc Python snippets, command substitution, or large remote shell blobs for routine repo work. If a step needs logic, put it in a repo-local helper under tools/ and run that helper through a simple command such as bash -lc node-tools, npm run, rsync, or ssh with a known helper command.

For small literal source edits where apply_patch is unavailable, use npm run dev:text-replace -- --file PATH --old OLD --new NEW, or pass --old-file and --new-file snippets. This keeps replacement logic inside the repo and avoids approval prompts caused by inline scripts.

## Dictionary

| Script | Purpose | Typical command |
| --- | --- | --- |
| `tools/build-chrome-dev.js` | Generate `chrome-dev/` from `chrome/` with the manifest key stripped for a separate unpacked dev ID. | `npm run build:chrome-dev` |
| `tools/cdp/launch-local-chrome.sh` | Launch local Chrome with a dedicated profile, the dev unpacked extension loaded, and CDP on `127.0.0.1:9222`. | `npm run launch:chrome-dev` |
| `tools/cdp/reload-chrome-dev.js` | Discover the loaded unpacked dev extension by path/version and reload it through `chrome.developerPrivate.reload`. | `npm run reload:chrome-dev` |
| `tools/cdp/reset-chrome-dev-tabs.js` | Keep `chrome://extensions/` plus an existing dashboard for the dev extension and close search/profile/other page tabs. Does not create the dashboard. | `npm run reset:chrome-dev-tabs` |
| `tools/cdp/live-test-loop.js` | Build, reload, reset tabs, discover ID, and optionally run one regression phase against the dev extension. | `node tools/cdp/live-test-loop.js --phase phase5-dashboard-readonly-authority-smoke` |
| `tools/cdp/reload-extension.js` | Clear/report extension errors and reload only when the install is not Web Store-backed. Prefer `reload-chrome-dev.js` for the dev loop. | `node tools/cdp/reload-extension.js --extension-id auto` |
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
| `tools/cdp/target-summary.js` | Summarize open CDP targets without evaluating page or worker JavaScript. Useful when the page or service worker is busy. | `node tools/cdp/target-summary.js` |
| `tools/cdp/close-profile-tabs.js` | Close open Quora profile page targets, optionally filtered by URL/title text. | `node tools/cdp/close-profile-tabs.js` |
| `tools/cdp/requeue-stale-active.js` | Requeue persisted active rows for a needle only when no live Quora profile tabs are open. Useful after a service-worker restart strands active rows. | `node tools/cdp/requeue-stale-active.js --needle profile-modal` |
| `tools/cdp/open-queued-storage-tabs.js` | Open a small batch of persisted queued rows as inactive profile tabs from an extension page, bypassing an asleep queue pump while preserving the durable claim path. | `node tools/cdp/open-queued-storage-tabs.js --needle profile-modal --limit 1` |
| `tools/cdp/resume-queue.js` | Ask the extension service worker to resume persisted coordinator queue work, unpausing first when Current Work is paused. | `node tools/cdp/resume-queue.js` |

Keep live UI driving on raw CDP. Puppeteer is intentionally not part of this
tool directory.
