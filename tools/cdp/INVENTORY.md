# CDP tools: forward-going use

Status as of 24 Oct 2026. This is the list of helpers in this folder that stay for forward use, with the reason for each, and the list retired on 24 Oct. The dictionary of usage is [README.md](README.md). Nothing is built from this file.

## How the list was made

- **Kept.** The helper is in the dictionary or the npm scripts; or current work notes name it; or it was changed in October 2026 for the current work; or a note, a test, or another helper uses it.
- **Kept, owner to confirm.** Nothing refers to the helper, and it was last changed in September 2026. It is kept because the cost of keeping it is small.
- **Retired.** Nothing refers to it (not the docs, the notes, the code, the tests, the other helpers, or the README), searched with and without the `.js` extension, and it was last changed before September 2026. Retired helpers are in git history: restore one with `git checkout -- tools/cdp/<name>.js`.

## Kept: core

- `lib/cdp.js`: the client every helper uses.
- `launch-local-chrome.js` and `launch-local-chrome.sh`: launch Chrome with the dev extension and remote debugging (`npm run launch:chrome-dev`).
- `reload-chrome-dev.js`, `reset-chrome-dev-tabs.js`, `live-test-loop.js`: npm scripts for the dev loop.
- `extension-info.js`: finds the dev extension id.
- `upgrade-regression/run.js` and `upgrade-regression/cleanup-artifacts.js`: the phased regression runner.

## Kept: in the dictionary

`reload-extension.js`, `space-summary.js`, `reload-space-tabs.js`, `inspect-space-state.js`, `space-contributors.js`, `queue-summary.js`, `queue-counts.js`, `queue-failures.js`, `inspect-queue-item.js`, `inject-content-script.js`, `queue-storage-summary.js`, `queue-wakeup-metrics.js`, `target-summary.js`, `close-profile-tabs.js`, `requeue-stale-active.js`, `open-queued-storage-tabs.js`, `resume-queue.js`.

## Kept: used by current work

- `audit-action-kinds.js`, `enqueue-visible-profile-search.js`, `inspect-queue-brief.js`, `inspect-recovered-queue-item.js`, `sw-queue-summary.js`, `clear-coordinator-test-state.js`: converted to read progress through the worker (coder instructions, section 4a).
- `wal-snapshot-benchmark.js`: named in the 25 Oct review. The space post map and its bucket reader are gone; it reads the queue and the run list as single prefixed keys.
- `storage-read-profile.js`: measures what is on disk, by design (coder instructions, section 4a).
- `storage-footprint.js`: the session storage measurement that the live check needs.
- `flight-recorder.js`: reads the recorder for the live checks.
- `check-checkpoint-codec.js`: checks the checkpoint codec.

## Kept: Windows launch and reset

`start-windows-debug-browser.js`, `windows-chrome-profile.js`, `reload-windows-extension.js`, `reset-windows-tabs.js`. These run on the Windows machine this project is developed on.

## Kept: changed in October 2026

`check-pause-button.js`, `clear-all-stats-dashboard.js`, `click-pause-current-work.js`, `click-resume-current-work.js`, `dashboard-metrics-read.js`, `dashboard-state.js`, `find-stale-profile-links-evidence.js`, `inspect-queue-item-live.js`, `progress-status-count.js`, `search-dashboard-text.js`, `target-breakdown.js`, `nine-dom-check.js`, `nine-position-check.js`, `nine-progress-check.js`.

## Kept: named by historical notes or used by another helper

`active-queue-rows.js`, `cancel-current-work.js`, `close-profile-search-tabs.js`, `current-work-filter.js`, `dump-storage-keys.js`, `extension-errors.js`, `inspect-messages-sender.js`, `open-dashboard.js`, `pause-queue.js`, `queue-accounting-audit.js`, `screenshot-tab.js`, `send-extension-message-json.js`, `probe-extension-storage.js` (used by code), `open-url.js` (used by another helper), `analyze-recorder-report.js` (used by another helper).

## Kept, owner to confirm: unreferenced, last changed in September 2026

`claim-tab-action.js`, `click-profile-block-confirm.js`, `click-profile-mute-confirm.js`, `export-profile-search-candidates.js`, `flight-recorder-audit.js`, `inspect-confirm-surfaces.js`, `inspect-sw-runtime-queue.js`, `profile-action-state.js`, `reconcile-queue.js`, `recover-queue-wal-from-raw.js`, `schedule-queue-alarm.js`, `why-not-running.js`, `pause-diagnostic-snapshot.js`.

Kept on purpose: `window-focus-summary.js`. The worker-window focus concern (25 Sep) is still open.

## Keep in mind: some kept helpers mention retired keys

These helpers mention storage keys that the 1.6 work has retired: `active-queue-rows.js`, `current-work-filter.js`, `queue-counts.js`, `queue-failures.js`, `queue-storage-summary.js`, `queue-summary.js`, `audit-action-kinds.js`, and `upgrade-regression/run.js`. `inspect-space-state.js`, `space-summary.js`, `storage-read-profile.js`, and `wal-snapshot-benchmark.js` read the stored (prefixed) names now, and no longer read the removed space post maps. Check a helper's output against the current keys before trusting it. The dead-ends review lists the readers to point at the log reader; that change is not made yet.

## Restored after a test needed it

`click-profile-extension-action.js`. The test `test/cdpClickProfileExtensionAction.test.js` loads it without the `.js` extension. The first search missed that form, so the helper was deleted with the others and then restored from git on 24 Oct. It is kept, and the test passes.

## Retired on 24 Oct 2026

32 helpers. Each had no references that the search found, and was last changed before September 2026. Restore any of them with `git checkout -- tools/cdp/<name>.js`.

- **Probes of closed investigations:** `probe-inspect-options.js`, `probe-isolated-worker-window.js`, `probe-resume.js`, `profile-search-eof-probe.js`, `profile-search-end-shape.js`.
- **Duplicates or superseded helpers:** `send-extension-message.js`, `sw-send-extension-message.js`, `tab-action-by-id.js`, `sw-tab-action-by-id.js`, `start-service-worker.js`, `wake-service-worker.js`, `sw-runtime-state.js`, `reload-extension-pages.js`, `reload-profile-search.js`, `reload-profile-tabs.js`, `extension-error-details.js`, `clear-extension-errors.js`, `close-extension-pages.js`, `activate-target.js`, `list-page-contexts.js`, `nudge-tab-action.js`, `pause-service-worker-stack.js`, `sw-pause-and-close-profile-tabs.js`, `queue-wakeup-tail.js`, `wal-records-for-key.js`.
- **UI drivers for flows of the earlier line:** `click-profile-mute-block-close.js`, `click-space-nuke.js`, `collect-profile-search.js`, `profile-controls.js`, `profile-page-state.js`, `profile-search-controls.js`.
- **Reads a retired structure:** `queue-view-timing.js` (the queue view was retired).

The root-level CDP copies (`mute-block-*.js` and one file with a mangled name) were also removed. They are recorded in [historical/removed-2026-10-24.md](../../historical/removed-2026-10-24.md).
