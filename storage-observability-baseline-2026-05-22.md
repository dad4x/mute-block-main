# Storage Observability Baseline - 2026-05-22

## Worker-Window Acceptance Checkpoint

- Extension version: 1.6.472
- Browser target: Windows Chrome via repo-local CDP helpers
- Source page: `https://www.quora.com/search?q=SEO&type=profile`
- Run id: `manual-visible-profile-search-1779481948743-g5imog`
- Input: 7 staged SEO profile rows from the current search page
- Immediate post-run observation:
  - All 7 staged row buttons showed `Nuked`
  - Queue summary reached terminal-only state with `359 succeeded`
  - No active rows, queued rows, failed rows, or profile tabs
  - Extension manifest/runtime errors clean
- Refreshed state after a short delay:
  - Extension `1.6.472` still clean
  - Queue summary reported `354 succeeded`
  - No active rows, queued rows, failed rows, or profile tabs

## Storage/Observability Caveat

After the successful run, broad extension-page/dashboard storage reads became
slow enough for CDP helpers to time out. The visible page and service-worker
summary showed successful completion, but detailed dashboard/storage inspection
was unreliable under the current storage shape.

## Next Slice Acceptance Criteria

- Dashboard/service-worker state can be inspected reliably after a 350-400 row
  run.
- Normal dashboard/status display does not require loading full queue and full
  progress maps.
- Metrics show read/write byte counts and latency by reason or call path.
- The slow path is pinned with a reproducible helper or test, not only live
  anecdote.
- WAL work starts only after identifying which full blob reads/writes remain
  hot.

## 1.6.475 Compact Queue View Validation

- Browser was restarted with only dashboard/extension pages active.
- Dashboard opened before visiting Quora and displayed existing history from
  `mbCoordinatorQueueView`: `339 jobs (80 shown)`, `339 terminal`, `0 queued`,
  `0 active`.
- Dashboard-sized storage profile, excluding the old full queue/progress read:
  - `mbCoordinatorQueueView`: about 64.9 KB, about 4.5 ms
  - `mbCoordinatorRuns`: about 56 KB, about 3 ms
  - `mbCoordinatorEvents`: about 30 KB, about 2 ms
  - `mbQueueWakeupMetrics`: about 940 KB after a short run, about 35 ms
- A 5-row SEO worker-window run completed cleanly:
  - Queue reached `344 succeeded`, `0 queued`, `0 active`
  - No profile tabs remained after teardown
  - Extension manifest/runtime errors stayed clean
- Current-epoch storage health for that run:
  - `storageUpdate.started = 229`, `completed = 229`
  - `timedOut = 0`, `deadlineMissed = 0`, `fallbackReturned = 0`
  - Write pressure was still high: about 134.6 MB written and 359.9 MB read in
    the epoch, dominated by full `queue` and `progress` snapshots.

## 1.6.476 Compact Metrics View Validation

- Added `mbQueueWakeupMetricsView` for normal dashboard reads. Full
  `mbQueueWakeupMetrics` remains available for diagnostic helpers.
- Dashboard opened after extension reload with the existing `344 jobs (80
  shown)` history and `Waiting for first Quora page`; it did not start work.
- Dashboard-sized storage profile now reads:
  - `mbCoordinatorQueueView`: about 64.9 KB, about 4.6 ms
  - `mbQueueWakeupMetricsView`: about 6.9 KB, about 4.5 ms
  - `mbCoordinatorRuns`: about 56.9 KB, about 3 ms
  - `mbCoordinatorEvents`: about 30.7 KB, about 2.4 ms
- Extension `1.6.476` loaded cleanly with no manifest/runtime errors.

Remaining storage work is now the full snapshot write/read path during actual
queue transitions, especially `queue` and `progress`. The normal dashboard read
path is bounded enough to use as an observability surface for WAL/delta work.

## 1.6.477 Live Dashboard Isolation Fix

- Removed the dashboard `storage.onChanged` listener so Chrome does not deliver
  full `mbCoordinatorQueue`, `mbProfileNukeProgress`, or `mbQueueWakeupMetrics`
  change payloads to an open dashboard during live runs.
- Dashboard live refresh now polls the same compact keys used for initial load.
- Bulk `Requeue Failed` now uses compact status counts and sends the service
  worker requeue request even when failed rows are outside the 80-row display
  projection.
- Live sanity after reload:
  - Extension `1.6.477` loaded cleanly with no manifest/runtime errors.
  - Dashboard showed `344 jobs (80 shown)`, `0 queued`, `0 active`, and
    `Waiting for first Quora page`.
  - Dashboard-sized storage profile still used only compact keys:
    `mbCoordinatorQueueView` about 64.9 KB, `mbQueueWakeupMetricsView` about
    6.7 KB, `mbCoordinatorRuns` about 56.9 KB, and `mbCoordinatorEvents` about
    30.7 KB.

## Post-1.6.477 Routine CDP Helper Bounds

- Routine queue status helpers now use `mbCoordinatorQueueView` by default:
  `queue-counts.js`, `current-work-filter.js`, `active-queue-rows.js`,
  `queue-failures.js`, and `queue-storage-summary.js`.
- `queue-storage-summary.js` keeps an explicit `--include-full` diagnostic mode
  for deliberate full queue/progress inspection.
- Live compact helper sanity:
  - Queue reported `344 succeeded`, `0 queued`, `0 active`, `0 failed`
  - Helpers reported `usedCompactView: true`
  - No profile tabs were present
- `npm test` passed after adding the compact-helper regression contract.

## 1.6.478 Profile-Search Scoped State

- Profile-search content pages no longer install the broad storage change
  listener on initial load, so ordinary queue/progress writes should not
  deliver full `mbCoordinatorQueue` or `mbProfileNukeProgress` blobs to the
  visible search page.
- Profile-search controls now refresh via a service-worker scoped state query
  for visible/staged profile hrefs and current search/run context.
- Routine CDP status helpers remain compact by default; `queue-storage-summary`
  keeps `--include-full` for deliberate diagnostics.
- Validation:
  - `npm test` passed at `1.6.478`
  - `npm run prod` succeeded
  - Built `chrome/mute_block-1.6.478.zip`
  - Built `firefox/mute_block-1.6.478.zip`
  - Windows Chrome loaded `1.6.478` with zero manifest/runtime errors
  - Background SEO search smoke showed content script `1.6.478` and live
    profile-search controls without queueing work
- Remaining observed hot path:
  - The scoped content-state request moved full queue/progress deserialization
    out of the content page, but the service worker still reads full
    `mbCoordinatorQueue` and `mbProfileNukeProgress` to build that projection.
    In the first live smoke epoch this appeared as
    `storagePayload.read.path.contentPageState.scoped`.

## 1.6.480 Content-Page Projection

- Added compact storage projections for content-page scoped state:
  `mbCoordinatorContentQueueIndex` and `mbProfileNukeProgressView`.
- Full `mbCoordinatorQueue` / `mbProfileNukeProgress` writes now maintain those
  projections, and `get-content-page-coordinator-state` reads the projections
  instead of full queue/progress blobs.
- The content-page response shape remains the same: `coordinatorQueue`,
  `profileNukeProgress`, `queueRows`, `progressRows`, and scoped metadata.
- A one-time compatibility rebuild is allowed when an older profile is missing
  the projection; ordinary profile-search reads then stay on the projection.
- Validation:
  - `node --check shared/js/sw.js` passed
  - `node --check shared/js/content.js` passed
  - `node test/p1-contract.test.js` passed
  - `npm test` passed
  - `npm run prod` succeeded
  - Built `chrome/mute_block-1.6.480.zip`
  - Built `firefox/mute_block-1.6.480.zip`
  - Windows Chrome loaded `1.6.480` with zero manifest/runtime errors
- Live SEO profile-search smoke after resetting metrics:
  - content script `1.6.480`
  - toolbar/buttons present
  - no queueing performed
  - `storagePayload.read.path.contentPageState.scoped.calls = 4`
  - `storagePayload.read.path.contentPageState.scoped.bytes = 887,264`
  - `storagePayload.read.path.contentPageState.scoped.maxBytes = 221,816`
  - `storagePayload.read.contentQueueIndex.maxBytes = 109`
  - `storagePayload.read.progressView.maxBytes = 221,707`
- Remaining storage work:
  - Full queue/progress reads still occur outside the content-page scoped path.
    In this smoke they were dominated by `storagePayload.read.path.unknown`
    and `storagePayload.read.path.loadCoordinatorState`.
  - The next storage cleanup slice should name those broad reads and move
    routine callers onto explicit compact projections or explicit diagnostic
    paths.
