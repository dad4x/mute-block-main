# Coordinator Page Refactor Plan 2026-05-08

This plan captures the current redesign direction for `mute-block-main` space-feed `Nuke 'Em` work. It is meant to survive disruption and give the next session a concrete restart point.

## Goal

Move long-running space-feed nuke coordination out of the original Quora page.

The original page should collect candidates and enqueue them, then return control to the user. A singleton extension-owned coordinator page should own queue state, scheduling, worker-tab lifecycle, timeout policy, and operator controls.

This addresses three current problems:

- throughput and browser contention during large asset-space runs
- tight coupling between the launching Quora page and worker tabs
- poor human factors when the parent page feels stalled while lengthy work continues

## Target Shape

- Parent Quora pages are intake surfaces.
- The coordinator extension page is the queue owner and monitor.
- The service worker is the browser API broker and recovery helper.
- Worker tabs execute one queue item and report milestones by item id.
- Additional asset pages can enqueue more candidates into the same coordinator queue.

## Progress

| Step | Status | Notes |
| --- | --- | --- |
| 1. Map current ownership | Complete | Current ownership map captured below. |
| 2. Define queue contract | Complete | Initial queue item, run, event, dedupe, status, and timeout shape captured below. |
| 3. Add passive coordinator page | Complete | Added read-only coordinator page and rebuilt `1.5.17` Chrome/Firefox artifacts. |
| 4. Convert parent `Nuke 'Em` to enqueue | Complete | Parent now records coordinator queue state, opens/reuses inactive coordinator, launches existing executor, and stops waiting for full drain. |
| 5. Move scheduling to coordinator | Complete | Space-feed execution is now owned by the coordinator tab while reusing the existing service-worker executor; live validation completed with a coordinator display fix in `1.5.20`. |
| 6. Report worker milestones by item id | Not started | Worker tabs report content open, claim, ready, action attempts, terminal outcome, close requested, and closed. |
| 7. Replace stale-active logic | Not started | Use milestone-aware deadlines instead of closing based only on tab age. |
| 8. Support multi-page intake | Not started | Enqueue from additional asset pages and dedupe against queued, active, and successful terminal records. |
| 9. Add human controls | Not started | Coordinator UI for pause/resume, stop-after-active, retry selected failures, clear completed, and export MB Info. |
| 10. Validate live | In progress | Windows Chrome CDP validation passed for 16-item and 30-item single-page runs; still need multi-page and larger-run validation. Live reload also exposed a stale per-post host attached to `<html>` over the contributors panel; fixed in `1.5.23` by rejecting document-level post-button roots/parents and cleaning any stale document-level hosts on resync. A later CrowdOut scroll showed buttons disappearing around `Mehedul-Islam-45` because `interrupted` progress records were treated as UI-settled; fixed in `1.5.24` so interrupted profiles remain retryable in asset-page controls without changing terminal history/coordinator accounting. In `1.5.25`, per-post controls split into black aggregate `Nuke 'Em N` buttons and red single-post `Mute-Block` buttons so an operator can queue the currently detected batch while scrolled down or retry only one row. In `1.5.26`, coordinator open was made single-flight and the single-post working style was fixed. In `1.5.27`, coordinator page de-dupe was added because Chrome still produced duplicate coordinator tabs under live races/restores; timeout/action-error coordinator failures were made retryable on re-enqueue, while security-verification remains terminal pending better classification. In `1.5.28`, expected queued-profile operational failures were demoted from `console.warn` to `console.info` so Chrome's extension Errors page is reserved for actionable extension errors. In `1.5.29`, retryable timeout/action-error coordinator failures can be reset from newer transient retry progress, while security-verification is explicitly not retryable. In `1.5.35`, source-page pending post state now counts only active/transient profile work; timeout-style terminal progress is retryable, and security-verification remains terminal. In `1.5.36`, block-confirm selection was narrowed to the modal/dialog submit button, and a `DW-908` coordinator retry completed with both progress and raw queue storage settled to blocked/succeeded. In `1.5.37`, old generic security-flagged rows require explicit security evidence before remaining classified as `security-verification`. In `1.5.38`, space-feed buttons rebind click handlers when a new content-script instance sees old DOM buttons after extension reload. In `1.5.39`, top and per-post aggregate buttons fall back to their stored URL dataset when the live entry cache is empty. In `1.5.40`, `Paused` is suppressed when owned/active/queued counts are all zero. In `1.5.41`, the service worker also clears raw stale paused owners with zero work, and background worker stale deadlines are aligned with content-side profile readiness/action waits. In `1.5.42`, temporary duplicate queued-worker diagnostics were added and marked for removal. In `1.5.43`, the diagnostic code was removed and content-originated progress events are written to storage only by the service worker when available. |

Recent validation notes:

- `1.5.60`: space-feed scans were bounded to the viewport neighborhood and
  nearest 60 timestamps after a huge slowdown on large loaded asset-space tabs.
- `1.5.61`: storage-driven refreshes were debounced while idle, and stale
  page-local `Nuking... N left` markers are cleared when storage has no active
  or queued work left.
- `1.5.62`: viewport-sampled feed scanning avoids the normal full-document
  timestamp query, and scroll idle now performs a bounded rescan so already
  loaded posts gain controls quickly after scrolling.
- `1.5.63`: post-enqueue button labels now use the same live remaining
  queueable/pending entry set as the top aggregate button, fixing mismatched
  `Nuking... N left` counts like `/home/dbrower/odd.png`.
- `1.5.64`: profile followers modal queueing now separates opened-row tracking
  from nuke-queued tracking, rebinds existing modal buttons after extension
  reload, and resets stale `Nuked` labels when queueable modal rows exist.
- `1.5.65`: space-feed aggregate counts now use a page-session accumulator of
  discovered candidates instead of only the current viewport scan, so the count
  should not fall while scrolling. Aggregate `Nuke 'Em` clicks now submit the
  button's saved URL snapshot filtered through the accumulated entries, and
  reused buttons are cloned before rebinding when a new content-script instance
  sees old DOM controls after extension reload.
- `1.5.66`: active styling now follows the launching control. A single-post
  `Mute-Block` run leaves aggregate `Nuke 'Em N` buttons as normal black
  candidate buttons, with the active single row showing progress. A batch run
  leaves the per-row single buttons neutral black/disabled instead of showing
  red single-row progress while the batch is active.
- `1.5.67`: space-feed queueing labels no longer expose the old internal
  `[t:a:q]` owner-status label on the clicked button; queueing is plain
  `Queueing...`, then `Nuking... N left`.
- `1.5.68`: service-worker recovery now reopens/reuses the coordinator when
  durable coordinator storage still has queued/active work. Recovery runs after
  extension update/startup, when queue storage changes, and when a content page
  asks for owned nuke status. This addresses pages showing `Nuking...` with no
  coordinator tab after a reload/update race.
- `1.5.69`: profile follower/following modal `Nuke 'Em` now actively scrolls
  the modal list while queueing, so virtualized follower lists are walked beyond
  the initially visible 19/20 rows. The loop stops only after repeated idle
  scroll attempts or a hard scroll-pass cap.
- `1.5.70`: modal `Nuke 'Em` discovery no longer waits for the first worker-tab
  queue response before scrolling. It walks the modal first, marks discovered
  rows, collects the full discovered URL set, and then submits one queue request
  with a bounded response wait so worker startup latency cannot cap discovery at
  the initially loaded follower rows.
- `1.5.71`: while a modal nuke walk is active, modal button refresh keeps the
  controls disabled and the nuke button in `Nuking...` state instead of letting
  mutation-driven reinjection relabel it back to idle `Nuke 'Em`.
- `1.5.72`: profile modal `Nuke 'Em` now enqueues worker tabs with
  `noForegroundFallback: true`, matching the coordinator path, so follower
  modal nukes should not raise each worker profile tab while processing.
- `1.5.73`: restart recovery treats space-feed progress rows with released
  worker slots as stale transient work. On page reload/restart they are
  reconciled to `interrupted` and removed from `mbSpacePendingNukedPosts`, so
  unrelated space pages do not keep showing `Nuking...` when there is no
  coordinator or service-worker queue left to run.
- `1.5.74`: active space-feed UI state no longer treats pending work from any
  space as active work for every open space page. Unknown/active `Nuking...`
  state is now driven by the page's owned worker status or by pending/nuking
  entries visible on that page, so Kicking loaded during an Instant Block run
  should still show idle `Nuke 'Em` controls for its own unqueued candidates.
- `1.5.75`: if viewport timestamp sampling misses while any space-feed pending
  work exists, scanning now returns no visible timestamps instead of falling
  back to a whole-document `a.post_timestamp` scan. This avoids long blocking
  scans on newly loaded asset pages while the coordinator is already putting
  pressure on Chrome.

## Windows Chrome Update Checklist

When the user copies a rebuilt `chrome/` directory to the Windows laptop, use
the following live-update order through CDP:

1. Inspect Mute Block on `chrome://extensions` before pressing Update.
2. If any `runtimeErrors`, `runtimeWarnings`, or `manifestErrors` are present,
   record the important messages, then clear them with
   `chrome.developerPrivate.deleteExtensionErrors`.
3. Re-read extension info and verify the error lists are empty before Update.
4. Press the extension manager `Update` button.
5. Verify the loaded extension version matches the rebuilt version.
6. Reload relevant Quora tabs and any coordinator tab.
7. Re-read extension info again and verify `runtimeErrors: []`,
   `runtimeWarnings: []`, and `manifestErrors: []`.
8. Check coordinator tabs; expected count after page reloads is zero unless a
   coordinator is actively open, and expected count during work is exactly one.
   Make this a standing check before live clicks, after extension reloads, and
   after any coordinator open/resume action. If two coordinator tabs are open,
   close the duplicate before continuing so the live evidence comes from one
   queue owner.

The working CDP extension id for the Windows Chrome unpacked load has been:

```text
ajcjckiafbnhioeafaejlaehkmdcdeha
```

The unpacked extension path on the Windows laptop has been:

```text
C:\Users\DBROWER\Documents\src\mute-block-main\chrome
```

When the laptop has the Cygwin copy reverse tunnel open, Codex can push the
rebuilt `chrome/` directory directly from this host before doing the Chrome
extension update. This is separate from the CDP tunnel on host port `9223`;
keep both SSH sessions open when Codex needs to copy files and then drive
Chrome.

Laptop-side Cygwin copy tunnel:

```bash
ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
  -R 10022:127.0.0.1:22 \
  dbrower@phoenix92608.dev3sub2phx.databasede3phx.oraclevcn.com
```

Host-side probe:

```bash
timeout 8 ssh -p 10022 -o BatchMode=yes \
  'DBROWER-X40-J+DBROWER@127.0.0.1' 'echo ok'
```

Host-side push command:

```bash
tar -C /scratch/dbrower/home/src/mute-block-main -cf - chrome \
  | ssh -p 10022 -o BatchMode=yes \
    'DBROWER-X40-J+DBROWER@127.0.0.1' \
    'mkdir -p /cygdrive/c/Users/DBROWER/Documents/src/mute-block-main && tar -xf - -C /cygdrive/c/Users/DBROWER/Documents/src/mute-block-main'
```

Verify with local and remote `sha256sum` for `chrome/manifest.json`,
`chrome/js/content.js`, and `chrome/js/sw.js`. More detailed copy-tunnel notes
are in `space-nuke-bidi-debugging-2026-05-07.md`.

The extension manager error surface records `console.warn` calls from content
scripts as runtime warnings. Expected queue outcomes should be stored in
progress/coordinator state rather than emitted as warnings; leave
`console.error` for unexpected exceptions.

For live browser driving, prefer real CDP mouse events over DOM API clicks.
Use `Runtime.evaluate`, `chrome.storage.local`, and `chrome.developerPrivate`
for inspection/setup only: reading queue state, marking test spaces as assets,
clearing extension errors, and reloading the extension are good API uses.
When testing operator behavior such as `Nuke 'Em`, bring the target page to the
front and send `Input.dispatchMouseEvent` at the button coordinates. Plain
`button.click()` and mouse dispatches to background tabs have both appeared to
complete without reaching the real extension interaction path.

## Live Test Asset Sources

Use the repo-local `assets` file as the default list of Quora pages to mark as
assets and use for coordinator validation. Current entries include:

```text
https://ummno.quora.com/
https://trollsgalore.quora.com/
https://trollpatrol2.quora.com/
https://takingoutthetrash.quora.com/
https://letsplaywhackatroll.quora.com/
https://spamdetectives.quora.com/
https://theobvioustrollshootinggallery.quora.com/
https://theqdefensecrew.quora.com/
https://instantblock.quora.com/
https://sockpuppestan.quora.com/
https://romancescammercentral.quora.com/
https://www.quora.com/search
```

For live validation, prefer loading several of these known spaces, marking
them as assets in the extension, hard reloading them after an extension update,
and queueing through their visible aggregate controls. This gives repeatable
multi-page coordinator coverage without depending on incidental tabs.

When the visible candidates run out, scroll the asset pages down a bit and let
the content script discover more posts before queueing again. Once the marked
asset pages are exhausted for the day, stop live candidate testing until the
next day rather than forcing more data.

## Initial Implementation Slice

The first useful slice is deliberately conservative:

1. Map current ownership.
2. Define the durable queue/coordinator contract.
3. Add a passive coordinator page.
4. Change the parent page only after the queue contract and passive page exist.

This should produce value without immediately rewriting every existing child-tab path.

## Step 1 Current Ownership Map

### Parent Quora Page: `shared/js/content.js`

The parent space page currently owns too much of the long-running operation:

- initializes local copies of space registry, pending posts, remembered nuked posts, and profile nuke progress
- reacts to storage changes and reschedules space-feed UI refreshes
- reconciles stale space-feed state through `reconcileStaleSpaceFeedProgress()`
- collects visible space-feed candidates
- builds per-profile post associations in `getSpaceFeedProfilePostAssociations()`
- starts a space-feed run in `nukeSpaceFeedEntries()`
- writes initial queued progress through `recordProfileNukeProgressBatch()`
- registers pending space-feed entries
- sends `enqueue-tabs` to the service worker
- waits for drain through `waitForOwnedNukeTabsToDrain()`
- periodically calls `sweepOwnedBlockedProfileTabs()`
- owns the active button text: `Queueing...`, `Nuking...`, `Settling...`, `Done`
- removes pending URLs when queueing fails or is canceled

This is the coupling to remove first. The parent should keep candidate collection and local button feedback, but it should stop owning drain/wait/sweep/reconcile for the whole run.

### Service Worker: `shared/js/sw.js`

The service worker currently owns browser API operations and a partial queue:

- stores profile progress and serializes some space-feed storage updates
- keeps `queuedTabActions`, active queued tabs, owned-tab maps, pending tab actions, and paused owners
- enqueues work from `enqueue-tabs`
- creates owned worker tabs in `fillQueuedTabs()`
- maps a child tab to an owner tab id
- holds pending tab action metadata until the child content script calls `claim-tab-action`
- releases slots through `releaseQueuedTab()`
- marks close timing through `markQueuedTabClosing()`
- sweeps terminal or blocked tabs
- applies stale-active timeout handling in `sweepStaleQueuedTabs()`
- reports owner-scoped status through `get-owned-nuke-status`
- stops owner work when the owner tab closes or navigates

This is the natural broker, but not the ideal policy owner. The coordinator should own queue policy while the service worker remains the privileged tab/storage broker.

### Worker Profile Tabs: `shared/js/content.js`

Worker tabs currently:

- call `claim-tab-action`
- derive `allowForegroundFallback` from `noForegroundFallback`
- record `tab-opened`, page-ready, mute/block, terminal, and error progress against a profile URL
- run `muteProfile()` and `blockProfile()`
- remove pending space-feed URLs and confirm blocked space-feed profiles
- release the queued slot
- request tab close

Worker tabs already have much of the right executor shape. The main missing contract is a durable item id/run id handshake instead of reporting primarily by profile URL and owner tab.

## Step 2 Initial Queue Contract

The coordinator queue should be explicit and durable. The first contract can live in storage as plain objects before extracting shared helpers.

### Storage Keys

Proposed new keys:

- `mbCoordinatorQueue`
- `mbCoordinatorRuns`
- `mbCoordinatorEvents`
- `mbCoordinatorSettings`

Keep existing keys during migration:

- `mbProfileNukeProgress`
- `mbSpacePendingNukedPosts`
- `mbSpaceNukedPosts`

### Queue Item

```json
{
  "id": "item-<timestamp>-<random>",
  "runId": "run-<timestamp>-<random>",
  "dedupeKey": "https://www.quora.com/profile/Some-User",
  "targetProfileHref": "https://www.quora.com/profile/Some-User",
  "requestedUrl": "https://www.quora.com/profile/Some-User",
  "source": {
    "type": "space-feed",
    "pageUrl": "https://example.quora.com/",
    "spaceKey": "example",
    "spaceCategory": "asset"
  },
  "evidence": [
    {
      "postKey": "post-key",
      "postUrl": "https://example.quora.com/post",
      "collector": "profile-links"
    }
  ],
  "status": "queued",
  "outcome": "",
  "error": "",
  "createdAt": 0,
  "updatedAt": 0,
  "queuedAt": 0,
  "activeAt": 0,
  "terminalAt": 0,
  "tabId": null,
  "attempt": 0,
  "maxAttempts": 1,
  "milestones": {
    "tabCreatedAt": 0,
    "navigationStartedAt": 0,
    "contentOpenedAt": 0,
    "actionClaimedAt": 0,
    "profileReadyAt": 0,
    "muteAttemptedAt": 0,
    "blockAttemptedAt": 0,
    "closeRequestedAt": 0,
    "tabClosedAt": 0
  }
}
```

### Run

```json
{
  "id": "run-<timestamp>-<random>",
  "sourceType": "space-feed",
  "createdAt": 0,
  "updatedAt": 0,
  "status": "active",
  "itemCount": 0,
  "activeCount": 0,
  "terminalCount": 0,
  "paused": false,
  "sourcePages": [
    "https://example.quora.com/"
  ]
}
```

### Events

Events should be append-style and optionally compacted later:

```json
{
  "id": "event-<timestamp>-<random>",
  "runId": "run-...",
  "itemId": "item-...",
  "type": "content-opened",
  "message": "Worker tab content script opened",
  "at": 0,
  "details": {}
}
```

### Dedupe Rules

- Primary dedupe key is normalized target profile URL.
- If a queued, active, or successful terminal item exists for the same dedupe key, execution should dedupe to one target while preserving all source/evidence associations.
- Parent pages that enqueue the same deduped target should remain able to track their own visible candidates, so evidence/source links must not be discarded just because execution deduped.
- Failed terminal items should not be retried automatically during intake.
- Evidence URLs remain attached even when the dedupe key is a profile URL.
- Content/question/article evidence must remain representable for later OP-chase resolution.

### Status Values

Initial status set:

- `queued`
- `active`
- `settling`
- `succeeded`
- `failed`
- `skipped`
- `canceled`

Initial outcome set should preserve current report language:

- `blocked`
- `already-blocked`
- `profile-unavailable`
- `security-verification`
- `error-page`
- `timeout`
- `action-error`
- `canceled`

### Milestone-Aware Timeout Direction

The stale timer should be based on the latest meaningful milestone:

- tab created but no navigation/content open: page-load deadline
- content opened but action not claimed: claim deadline
- action claimed but no profile ready: profile-ready deadline
- mute/block in progress: longer action deadline
- close requested: close-confirm deadline

This avoids closing a slow Quora tab before the content script has had a realistic chance to open and claim the item.

## Step 3 Passive Coordinator Page

Initial files:

- `shared/coordinator.html`
- `shared/js/coordinator.js`
- `shared/css/coordinator.css`
- `webpack.mix.js`

The first page is intentionally read-only. It watches:

- `mbCoordinatorQueue`
- `mbCoordinatorRuns`
- `mbCoordinatorEvents`
- `mbProfileNukeProgress`
- `mbSpacePendingNukedPosts`
- `mbSpaceNukedPosts`

Current purpose:

- provide a durable extension page that can become the queue owner later
- verify build/package plumbing for a non-popup extension page
- expose summary counts for future queue state while also showing existing progress state

Current non-goals:

- no scheduling ownership yet
- no parent-page enqueue change yet
- no worker-tab item-id handshake yet
- no pause/resume/stop controls yet

Validation completed for this slice:

- `node --check shared/js/coordinator.js`
- `node --check shared/js/content.js`
- `node --check shared/js/sw.js`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm test`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run prod`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:chrome`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:firefox`

Artifact sanity checks completed:

- `chrome/manifest.json` version is `1.5.17`
- `firefox/manifest.json` version is `1.5.17`
- `chrome/mute_block-1.5.17.zip` contains `coordinator.html`, `js/coordinator.js`, and `css/coordinator.css`
- `firefox/mute_block-1.5.17.zip` contains `coordinator.html`, `js/coordinator.js`, and `css/coordinator.css`

## Step 4 Agreed Direction

Decisions made before implementation:

- `Nuke 'Em` should open or reuse one inactive `coordinator.html` tab.
- Opening/reusing the coordinator must not steal focus from the current Quora page.
- The parent page should stop being the long-run owner, but it may continue showing `Nuking...`.
- When possible, the parent button should show how many of that page's candidates remain.
- Execution should dedupe targets by normalized profile URL.
- Dedupe must not lose source/evidence associations, because the enqueuing parent pages still need to understand their own candidate state.
- Durable coordinator queue persistence is desirable eventually, but the first transition does not need full restart recovery.
- Queue entries may converge with the existing remembered-nuke storage model by using an `enqueued` state before `nuked`.

First Step 4 implementation slice:

1. Add service-worker support for opening/reusing the inactive coordinator page.
2. Add service-worker support for appending coordinator queue/run/event state.
3. Have the parent page enqueue coordinator-tracked items before invoking the existing executor.
4. Stop the parent from waiting for full drain; leave visible state updates to storage-driven refreshes.

Implemented in `1.5.18`:

- Added service-worker coordinator storage keys:
  - `mbCoordinatorQueue`
  - `mbCoordinatorRuns`
  - `mbCoordinatorEvents`
- Added `enqueue-coordinator-items` runtime action.
- Added `open-coordinator` runtime action and inactive coordinator tab reuse.
- Space-feed `Nuke 'Em` now sends coordinator items with source and evidence before launching the existing executor.
- Coordinator items dedupe by normalized profile URL while merging source/evidence associations.
- Existing progress writes now update matching coordinator queue items.
- Parent space-feed button no longer waits for full drain after queue launch.
- Parent top button now favors `Nuking... N left` based on that page's remaining live candidates when possible.

Still deferred to Step 5 and later:

- coordinator-owned scheduling
- worker-tab item-id claim handshake
- coordinator pause/resume/stop controls
- full browser-restart recovery for coordinator queue state

## Step 5 Coordinator-Owned Execution Slice

Narrow implementation goal:

- Space-feed parent pages should no longer call `enqueue-tabs` directly.
- The service worker should enqueue the existing tab executor under the inactive coordinator tab as owner.
- Parent page reuse, navigation, or close should not cancel the queued space-feed work.
- The existing service-worker executor can still run the actual tabs in this slice.

Not included in this slice:

- moving the scheduling loop into `coordinator.js`
- worker claim by coordinator item id
- full pause/resume/stop UI
- restart recovery

Implemented in `1.5.19`:

- Space-feed parent pages no longer call `enqueue-tabs` directly.
- `enqueue-coordinator-items` can now store coordinator state and start execution.
- Existing worker-tab execution is owned by the coordinator tab id instead of the launching Quora tab id.
- Parent page reuse, navigation, or close should no longer cancel queued space-feed work.
- Coordinator tab loading is ignored by owner-navigation pause logic.
- No-foreground-fallback queued tabs are created inactive.
- Pause from a space-feed button now targets coordinator-owned queued work first.

Still deferred:

- moving the scheduling loop itself into `coordinator.js`
- claiming worker actions by coordinator item id rather than profile URL and pending tab action
- coordinator UI controls for pause/resume/stop/retry
- restart recovery
- live browser validation against a large Quora run

Validation completed for `1.5.19`:

- `node --check shared/js/content.js`
- `node --check shared/js/sw.js`
- `node --check shared/js/coordinator.js`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm test`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run prod`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:chrome`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:firefox`
- package, Chrome manifest, and Firefox manifest versions are `1.5.19`
- `chrome/mute_block-1.5.19.zip` and `firefox/mute_block-1.5.19.zip` include coordinator, content, and service-worker outputs

Live validation on Windows Chrome through CDP:

- Loaded extension id: `ajcjckiafbnhioeafaejlaehkmdcdeha`
- Loaded version: `1.5.19`
- Test page: `https://letsplaywhackatroll.quora.com/?__ni__=0&__tiids__=212091822&__filter__=all&__nsrc__=notif_page&__sncid__=73747511137&__snid3__=98009988437#anchor`
- Initial top button had 16 candidates.
- Clicking top `Nuke 'Em` opened one inactive `coordinator.html` tab.
- Worker profile tabs opened inactive; the asset page remained the active tab.
- Parent button advanced through `Nuking... N left`.
- Run finished with parent button `Nuked`, zero profile tabs left, `pendingPosts: 0`.
- Final legacy progress was `7 already-blocked` and `9 blocked`.

Live validation follow-up defect:

- Coordinator queue storage remained `queued` for all 16 items even though `mbProfileNukeProgress` reached terminal states.
- Queue keys and progress keys matched exactly, so the issue was not URL normalization.
- `1.5.20` fixes the coordinator display by deriving row/run state from `mbProfileNukeProgress` when queue rows are stale.

Additional live validation for `1.5.20`:

- User copied the rebuilt Chrome output to the Windows laptop profile and loaded version `1.5.20`.
- First attempt after copy produced a page popup saying nothing was queued; inspection showed the asset page still had an injected button but the Mute Block service worker was not listed, consistent with a stale content-script/runtime state after extension reload.
- After the user closed the popup and reloaded the asset page, clicking `Nuke 'Em` through CDP started cleanly.
- Test page had 30 candidates and 49 visible post buttons before click.
- Parent button changed to `Nuking... 30 left` with no dialog.
- One inactive `coordinator.html` tab opened and worker profile tabs opened inactive.
- Final asset-page state was `Nuked`, `state=done`, and no worker profile tabs remained.
- Coordinator UI showed 0 queued, 0 active, 46 terminal, 2 runs complete; latest run `space-feed-1778301808813-dinnxa` completed 30 items.
- Raw coordinator storage still had stale queue/run statuses (`queued` queue rows and `active` runs), while the coordinator display reconciled correctly from `mbProfileNukeProgress`. A later slice should write reconciled terminal state back to `mbCoordinatorQueue` and `mbCoordinatorRuns`, not only derive it for display.

Implemented in `1.5.21`:

- Coordinator progress sync now writes reconciled status, outcome, error, active time, terminal time, attempt metadata, and milestones back to `mbCoordinatorQueue`.
- Coordinator progress sync now recomputes affected `mbCoordinatorRuns`, including `itemCount`, `activeCount`, `terminalCount`, and `complete` run status when all run items are terminal.
- The service worker now listens for direct `mbProfileNukeProgress` storage changes, so content-script progress writes also converge coordinator storage.
- Service-worker startup now reconciles existing profile progress into coordinator storage, which should repair stale `1.5.20` queue/run storage after loading `1.5.21`.

Validation completed for `1.5.21`:

- `node --check shared/js/sw.js`
- `node --check shared/js/content.js`
- `node --check shared/js/coordinator.js`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm test`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run prod`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:chrome`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:firefox`
- package, Chrome manifest, and Firefox manifest versions are `1.5.21`
- `chrome/mute_block-1.5.21.zip` and `firefox/mute_block-1.5.21.zip` include coordinator and service-worker outputs

Live validation result for `1.5.21`:

- Windows Chrome CDP and storage evaluation worked after browser restart.
- Loaded Mute Block manifest version was `1.5.21`.
- Existing coordinator queue still showed 76 `queued` rows and active runs despite 76 matching profile progress records.
- A direct manual storage update through CDP succeeded, proving storage itself was writable.
- Conclusion: passive startup/onChanged repair was insufficient as the only convergence path.

Implemented in `1.5.22`:

- Added service-worker runtime action `repair-coordinator-storage`.
- Added `repairCoordinatorStorageFromProgress()` to repair coordinator rows by direct queue-key/item-to-progress matching, then recompute all runs.
- Coordinator page now calls `repair-coordinator-storage` on load and reloads state if queue or run storage changed.

Validation completed for `1.5.22`:

- `node --check shared/js/sw.js`
- `node --check shared/js/coordinator.js`
- `node --check shared/js/content.js`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm test`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run prod`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:chrome`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:firefox`
- package, Chrome manifest, and Firefox manifest versions are `1.5.22`
- `chrome/mute_block-1.5.22.zip` and `firefox/mute_block-1.5.22.zip` include the explicit coordinator repair action

Validation completed for `1.5.20`:

- `node --check shared/js/coordinator.js`
- `node --check shared/js/content.js`
- `node --check shared/js/sw.js`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm test`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run prod`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:chrome`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:firefox`
- package, Chrome manifest, and Firefox manifest versions are `1.5.20`
- `chrome/mute_block-1.5.20.zip` and `firefox/mute_block-1.5.20.zip` include coordinator, content, and service-worker outputs

Validation completed for `1.5.18`:

- `node --check shared/js/content.js`
- `node --check shared/js/sw.js`
- `node --check shared/js/coordinator.js`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm test`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run prod`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:chrome`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:firefox`
- `chrome/manifest.json` version is `1.5.18`
- `firefox/manifest.json` version is `1.5.18`
- `chrome/mute_block-1.5.18.zip` includes coordinator, content, and service-worker outputs
- `firefox/mute_block-1.5.18.zip` includes coordinator, content, and service-worker outputs

Validation completed for `1.5.30`:

- `node --check shared/js/sw.js`
- `node --check shared/js/coordinator.js`
- `node --check shared/js/content.js`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm test`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run prod`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:chrome`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:firefox`
- package, Chrome manifest, and Firefox manifest versions are `1.5.30`
- `chrome/mute_block-1.5.30.zip` and `firefox/mute_block-1.5.30.zip` include the coordinator resume heartbeat and persisted-queue executor reconstruction

Validation completed for `1.5.31`:

- `node --check shared/js/sw.js`
- `node --check shared/js/content.js`
- `node --check shared/js/coordinator.js`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm test`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run prod`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:chrome`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:firefox`
- package, Chrome manifest, and Firefox manifest versions are `1.5.31`
- `chrome/mute_block-1.5.31.zip` and `firefox/mute_block-1.5.31.zip` include the narrower security-verification detection and stale security-row retry reset

Validation completed for `1.5.32`:

- `node --check shared/js/coordinator.js`
- `node --check shared/js/sw.js`
- `node --check shared/js/content.js`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm test`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run prod`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:chrome`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:firefox`
- package, Chrome manifest, and Firefox manifest versions are `1.5.32`
- `chrome/mute_block-1.5.32.zip` and `firefox/mute_block-1.5.32.zip` include the raw-storage pending repair trigger

Validation completed for `1.5.33`:

- `node --check shared/js/coordinator.js`
- `node --check shared/js/sw.js`
- `node --check shared/js/content.js`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm test`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run prod`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:chrome`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:firefox`
- `node --check chrome/js/coordinator.js`
- package, Chrome manifest, and Firefox manifest versions are `1.5.33`
- `chrome/mute_block-1.5.33.zip` and `firefox/mute_block-1.5.33.zip` include coordinator page branding, source/submitted run labels, newest-first run sorting, event list rendering, and event clear support

Validation completed for `1.5.34`:

- `node --check shared/js/coordinator.js`
- `node --check shared/js/sw.js`
- `node --check shared/js/content.js`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm test`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run prod`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:chrome`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:firefox`
- `node --check chrome/js/coordinator.js`
- package, Chrome manifest, and Firefox manifest versions are `1.5.34`
- `chrome/mute_block-1.5.34.zip` and `firefox/mute_block-1.5.34.zip` include separate Runs `Clear Completed` support and hide orphan runs from the Runs list while leaving them in Events

## Design Constraints

- Do not amplify retries to solve slow Quora loads. Prior `1.5.13` evidence showed aggressive retry increased pressure and bad page loads.
- Keep space-feed concurrency as internal policy unless live evidence shows user tuning helps.
- Dedupe by normalized target profile URL, not evidence post URL.
- Preserve evidence post URLs and post keys for reporting and later OP-chase work.
- Do not reject content/question/article evidence URLs outright; some asset-space cases need original-poster resolution.
- The coordinator may be an inactive extension tab first. A truly hidden coordinator can be considered later, but service-worker-only orchestration and Chrome-only offscreen documents have portability and observability tradeoffs.
- Any shipped behavior change must bump the extension version first and end with rebuilt Chrome and Firefox artifacts.

## Live Debug Checkpoint 2026-05-09

Running browser:

- Windows Chrome is reachable from this host at `127.0.0.1:9223` through the reverse SSH tunnel.
- Use direct CDP HTTP/WebSocket probes, not Puppeteer.
- Loaded Mute Block extension id is `ajcjckiafbnhioeafaejlaehkmdcdeha`.
- Loaded extension version is `1.5.28`.
- Extension Errors page was clean during the checkpoint:
  - `runtimeErrors: []`
  - `runtimeWarnings: []`
  - `manifestErrors: []`
- One coordinator tab was open.

Observed coordinator/storage state:

- Coordinator queue had 108 rows:
  - 70 `succeeded`
  - 38 `failed`
- Outcomes:
  - 52 `already-blocked`
  - 18 `blocked`
  - 30 `timeout`
  - 8 `security-verification`
- Recent runs were terminal/complete except stale active run records from older enqueue attempts.

Open debugging issues:

1. Security-verification classification is noisy if read from profile progress alone.
   - Many successful rows still have `profileNukeProgress[profile].securityVerification === true`.
   - Some of those rows are now coordinator `succeeded/already-blocked` or `succeeded/blocked`.
   - For live triage, treat coordinator queue outcome `security-verification` as the meaningful failure set.
   - Do not count raw `securityVerification: true` in progress as a current failure without checking coordinator outcome and success state.

2. Timeout retry is not actually reliable yet.
   - The intended behavior is to retry timeout/action-error rows on re-enqueue.
   - Live storage showed coordinator rows still terminal `failed/timeout` while matching profile progress rows had been reset to transient `queued`.
   - Examples included `Akhandanand-Tripathi-17`, `Brad-Meek-9`, `Elon-Musk-X-51`, `Factotum-5`, `Frankie-Goes-Hollywood`, `Marley-Wilcox-3`, and `Mitchell-Carman`.
   - The service-worker repair/sync path currently refuses to downgrade a terminal coordinator row from a transient progress row:
     `if(isTerminalCoordinatorStatus(item.status) && !isTerminalCoordinatorStatus(mapped.status)) continue`.
   - That preserves stale terminal coordinator rows after a parent page records a fresh queued retry.
   - Likely fix: when the transient progress record is newer and has a new `runId` or fresh `Queued from space feed` event, allow retryable coordinator failures to reset to `queued` with cleared `outcome/error/terminalAt/tabId/milestones`.
   - Implemented in `1.5.29`: retryable timeout/action-error coordinator failures can be reset from newer transient progress; `security-verification` is explicitly excluded from retryability.

3. "Nothing was queued" can occur while visible buttons still show candidates.
   - CrowdOut showed visible aggregate `Nuke 'Em 27`.
   - The button dataset had 27 profile URLs.
   - Storage for those URLs included a mix of coordinator `failed/timeout`, `failed/security-verification`, and no coordinator row; profile progress included `interrupted`, `queued`, and missing rows.
   - If enqueue merges terminal coordinator rows but `enqueueExistingExecutorForCoordinator()` skips because profile progress is terminal or stale, the parent can observe no executable work and show the popup.
   - This should be debugged with coordinator enqueue result fields `queued`, `merged`, and `executionQueued` plus per-URL skip reasons.

4. Parent-page UI can stay busy after coordinator work is gone.
   - Trolls galore showed single buttons `Nuking... 1 left`.
   - At the same time coordinator had no active rows and no active tabs.
   - This points at stale `mbSpacePendingNukedPosts` or transient profile progress not being reconciled back into the page controls.
   - Fix should converge parent UI from coordinator/progress state, not require a manual reload.

5. Manifest V3 service-worker memory loss can strand persisted coordinator work.
   - After loading `1.5.29`, pressing a Trolls galore aggregate caused one coordinator to appear and several source-page buttons to update together.
   - The run then settled with no live profile worker tabs, no extension errors, and storage still showing `1 active + 22 queued`.
   - The active row (`Frankie-Goes-Hollywood`) already had terminal success progress, but the coordinator row had not been reconciled before the service worker went away.
   - This shows the persisted coordinator queue survived, but the in-memory executor queue (`queuedTabActions` / `activeQueuedTabs`) did not.
   - Implemented in `1.5.30`: the coordinator page sends a lightweight resume heartbeat while display rows are `queued`, `active`, or `settling`; the service worker repairs coordinator storage from progress and reconstructs executor actions from persisted pending coordinator rows when its in-memory queue is empty.
   - Live validation after loading `1.5.30`: opening the coordinator resumed the stranded rows and drained pending work from `23` to `0`, ending at `92 succeeded` and `24 failed`, with no runtime/manifest errors.
   - Operator note: opening the coordinator with CDP `/json/new` raises that tab. That is a debug fallback only; the extension's own `chrome.tabs.create(..., active: false)` path remains the intended user path.

6. Security-verification was over-classified.
   - The stored coordinator `security-verification` set contained rows whose latest progress was fresh `queued` with `securityVerification: false`; those rows stayed failed only because `1.5.29`/`1.5.30` treated security-verification as non-retryable.
   - The fresh `SapienSedigitus` example looked like a profile tab opened and closed without action, not a clear security verification page; selector-only Turnstile detection was too broad for normal Quora pages.
   - Implemented in `1.5.31`: selector-only `cf-turnstile`/`#challenge-stage` no longer marks a page as security verification, and stale coordinator `security-verification` rows reset when newer transient progress says `securityVerification: false`.
   - Live validation after loading `1.5.31`: stale security rows dropped from `9` to `3`; `Christopher-Watson-507`, `Coraly-Colucci`, `DW-908`, `Joel-Howard-73`, `Maxim-Antov`, and `Paul-Geishert-2` reset and executed. Five became `already-blocked`; `DW-908` retried and ended interrupted rather than security-verification.

7. Coordinator display repair can stop too early.
   - After the `1.5.31` retry run, raw coordinator storage still showed `1 active + 5 queued`, while matching progress rows were terminal and the coordinator display would merge them as done.
   - Manual `repair-coordinator-storage` settled the queue to `97 succeeded`, `19 failed`, `0 pending`.
   - Implemented in `1.5.32`: the coordinator resume/repair heartbeat now also considers raw stored queue rows, not only display rows after progress merge.
   - Live validation after loading `1.5.32`: extension errors stayed clean, coordinator opened inactive, and storage remained settled at `97 succeeded`, `19 failed`, `0 pending` with no profile worker tabs.

8. Timeout retry and block confirmation now have a clean small-case coordinator pass.
   - Implemented in `1.5.35`: source-page pending post state counts only active/transient profile work, and timeout-style terminal rows are retryable from source pages.
   - Implemented in `1.5.36`: block-confirm selection only accepts the modal/dialog submit button, avoiding the earlier false confirmation against the profile menu's own `Block` row.
   - Live validation on `DW-908`: after the user unblocked/unmuted the target and its stored rows were reset, the Trolls galore aggregate `Nuke 'Em` path muted and blocked it through the coordinator.
   - Final storage state for that retry: profile progress `status: blocked`, coordinator queue row `status: succeeded`, `outcome: blocked`, no pending post row, and the evidence restored under `mbSpaceNukedPosts`.

9. Security-verification rows were still too sticky.
   - Live `1.5.36` storage had three `failed/security-verification` rows: `Dear-son-I-Have`, `Rai-1006`, and `SapienSedigitus`.
   - Inactive live opens showed all three load normal profile pages with no security text. `Dear-son-I-Have` and `SapienSedigitus` were already blocked; `Rai-1006` still had visible `Mute Block` controls.
   - Implemented in `1.5.37`: fresh records store `securityVerificationReason`, and progress-to-coordinator mapping treats `securityVerification: true` as real only when stored evidence contains explicit challenge/security text or URLs.
   - Live validation after loading `1.5.37`: an explicit repair pass reclassified the three old generic rows to `failed/action-error`.

10. Extension reload can leave dead space-feed button handlers.
   - After `1.5.37`, the Trolls galore aggregate button for `Rai-1006` was visible and enabled, and CDP click capture showed the click reached the button.
   - The extension handler did not run, leaving storage unchanged and no worker/coordinator tabs. This points at old DOM buttons surviving extension reload with dead content-script listeners.
   - Implemented in `1.5.38`: space-feed top, post aggregate, and post single buttons stamp the content-script instance that bound them and rebind when a new instance sees an existing button.
   - Live validation after loading `1.5.38`: Chrome did not inject the new content script into the already-loaded page, so a hard reload was still needed. After hard reload, the button was stamped with the new handler but the click still did not enqueue because `latestSpaceFeedEntries` was empty.
   - Implemented in `1.5.39`: top and per-post aggregate buttons use their stored URL dataset as a fallback when live entries are empty.
   - Expected live validation after copy/update: hard reload Trolls galore, then click the visible `Rai-1006` aggregate and verify it enqueues.

11. Paused label with zero work is invalid.
   - After the successful `Rai-1006` retry, the source page briefly showed an incoherent `Paused [t:0 a:0 q:0]` style label.
   - Implemented in `1.5.40`: owned-nuke status normalizes `paused` to false when owned/active/queued are all zero, and the top space-feed button only renders `Paused` when work is actually in flight.

Useful next probes:

- After loading `1.5.39`: hard reload Trolls galore, click the visible `Rai-1006` aggregate button, and verify it enqueues and drains.
- For service-worker resume: after loading `1.5.30`, leave the coordinator open and verify the stranded `space-feed-1778307144582-ybdajw` rows open new profile tabs and drain instead of remaining `queued` with no worker tabs.
- For stale UI: inspect `mbSpacePendingNukedPosts` for the visible post key and verify whether the remaining URL has matching `profileNukeProgress` and coordinator status.

## Current Known State

- Active branch: `refactor/1.5`
- Current source/build version at latest progress update: `1.5.52`
- Current built artifacts expected:
  - `chrome/mute_block-1.5.52.zip`
  - `firefox/mute_block-1.5.52.zip`
- Live debugging paths available:
  - Windows Chrome through reverse SSH tunnel on `127.0.0.1:9223` using direct CDP, not Puppeteer
  - local Firefox real-profile BiDi path from `space-nuke-bidi-debugging-2026-05-07.md`

## Restart Checklist

1. Run `skills-book`.
2. Read this file and `space-nuke-bidi-debugging-2026-05-07.md`.
3. Check `git status --short`.
4. Verify package and manifest versions before any shipped-code edit.
5. Continue from the first non-complete item in the Progress table.

## 1.5.41 Timeout Deadline Patch

Root cause for the next timeout lane:

- no-foreground space-feed worker tabs can wait up to 25 seconds in content code for profile actions to become available
- the service worker stale-active path was allowed to close the same background worker path after 15 seconds
- that matches the previously observed 16-18 second stale/timeout failures and explains rows where `Queued tab opened` arrived after stale close had already started

Implemented in `1.5.41`:

- service-worker background tab opening deadline is now 45 seconds until content has reported `contentOpenedAt`
- background profile-ready deadline is now 35 seconds after content opens and before `actionReadyAt`
- mute/block action-stage deadline is now 30 seconds
- raw `get-owned-nuke-status` now reports `paused: false` and clears the paused-owner set when `active`, `owned`, and `queued` are all zero

Validation completed locally:

- `node --check shared/js/sw.js`
- `node --check shared/js/content.js`
- `node --check shared/js/coordinator.js`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm test`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run prod`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:chrome`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:firefox`

Built artifacts:

- `chrome/mute_block-1.5.41.zip`
- `firefox/mute_block-1.5.41.zip`

Next live validation:

- copy/load `1.5.41`
- clear extension errors before update, update the unpacked extension, then hard reload active Quora asset tabs
- retry a visible old timeout row from CrowdOut such as `Matt-Fuller-54`
- expected source-page state is `Nuking... N left`, never `Paused [t:0 a:0 q:0]`
- if a timeout still occurs, inspect whether it closed before `contentOpenedAt`, before `actionReadyAt`, or during `muting`/`blocking`

Live validation result:

- Windows Chrome updated cleanly from `1.5.40` to `1.5.41`; extension error surface stayed at zero runtime errors, zero runtime warnings, and zero manifest errors
- hard reloaded Trolls Galore, CrowdOut, and Notifications after extension reload
- CrowdOut exposed a single visible aggregate retry for `Matt-Fuller-54`
- CDP mouse coordinates did not start the run immediately, but an in-page click dispatch reached the current `space-feed-top` handler and enqueued the retry
- source-page button moved to `Nuking... 1 left`, then settled to `Nuked` with no `Paused [t:0 a:0 q:0]` state
- final profile progress for `Matt-Fuller-54`: `status: blocked`, `blockSucceeded: true`, `finalError: ""`, `closeReason: terminal-progress-record`
- final coordinator queue row: `status: succeeded`, `outcome: blocked`, `error: ""`
- pending post rows for `Matt-Fuller-54`: `0`
- profile worker tabs for `Matt-Fuller-54`: `0`; one coordinator tab remained open

## 1.5.42 Duplicate Executor Diagnostic Patch

Next known problem after the successful `Matt-Fuller-54` retry:

- the run succeeded, but progress events appeared in duplicate pairs
- duplicate examples included `Queued from space feed`, `Profile actions became available`, `Mute flow started`, `Mute completed`, `Block flow started`, and repeated terminal close requests
- the suspected causes are either multiple content-script/executor paths or the existing content-side local progress write plus service-worker progress write recording the same event twice

Implemented temporary instrumentation in `1.5.42`.

Removal marker:

```text
TEMP-DIAGNOSTIC remove after duplicate queued worker debug
```

Diagnostic fields now stored on queued-worker progress records:

- `mbDiagnosticNote`
- `mbDiagnosticContentInstanceId`
- `mbDiagnosticExecutorId`
- `mbDiagnosticClaimId`
- `mbDiagnosticClaimTabId`
- `mbDiagnosticOwnerTabId`
- `mbDiagnosticRunId`
- `mbDiagnosticItemId`

Content-side queued-worker events now include an `mbdiag` suffix with claim, executor, and content-instance ids. The service worker now creates a claim id when `claim-tab-action` succeeds and carries run/item ids from coordinator queue items into worker tab metadata. Release/close requests also pass diagnostics back to the service worker.

Interpretation for the next live run:

- duplicate event text with the same `claim`, `exec`, and `inst` points to duplicate progress recording, likely the content local write plus service-worker write path
- different `exec` values with the same `inst` means one content-script instance started multiple executors
- different `inst` values means multiple content-script instances were active in the worker tab
- a `Duplicate queued executor suppressed` event means the page-global guard caught a second executor while one was active

This instrumentation should be removed once the duplicate source is identified.

Validation completed locally:

- `node --check shared/js/content.js`
- `node --check shared/js/sw.js`
- `node --check shared/js/coordinator.js`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm test`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run prod`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:chrome`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:firefox`

Built artifacts:

- `chrome/mute_block-1.5.42.zip`
- `firefox/mute_block-1.5.42.zip`

Live validation result:

- Windows Chrome updated cleanly from `1.5.41` to `1.5.42`; extension error surface stayed at zero runtime errors, zero runtime warnings, and zero manifest errors
- hard reloaded CrowdOut, Trolls Galore, and Notifications
- CrowdOut exposed a single visible aggregate retry for `Tyler-D-Schafer`
- retry ran through the coordinator and settled successfully:
  - source button text: `Nuked`
  - profile progress: `status: blocked`, `blockSucceeded: true`, `finalError: ""`
  - coordinator row: `status: succeeded`, `outcome: blocked`, `error: ""`
  - pending post rows: `0`
- diagnostic result: duplicate action events had the same claim, executor, and content instance:
  - `claim-1778313541538-jl0xut`
  - `exec-1778313541600-5lttj6`
  - `1778313540472-c6dd54`
- that rules out multiple content-script instances and multiple executors for this sample; the duplicate source is the progress recording path
- likely cause: `recordProfileNukeProgress()` writes locally in the content script, then asks the service worker to record the same event again; service-worker writes for close/slot release add another expected source
- note: terminal service-worker writes currently preserve the claim id but can overwrite stored executor/content-instance fields with blank values; the event suffixes were the reliable evidence for this run

Next fix target:

- remove the temporary diagnostic after the next patch
- stop duplicating content-originated progress events between the content local write and the service-worker write, or make the service worker merge by event identity rather than appending the same event again
- preserve non-empty diagnostic fields when merging progress patches if any diagnostic remains during cleanup

## 1.5.43 Duplicate Progress Fix

Implemented after the `1.5.42` diagnostic run:

- removed the temporary duplicate queued-worker diagnostic source markers and runtime fields
- changed content-side progress recording so the content script updates only its in-memory state first
- the service worker is now the normal storage writer for `record-nuke-progress` and `record-nuke-progress-batch`
- content falls back to the old direct local-storage write only if the service-worker message does not report `recorded: true`

Expected effect:

- content-originated events such as `Mute completed`, `Block flow started`, and `Block completed` should appear once instead of once from content storage and once from the service worker
- owner/source pages still get immediate in-memory state updates
- extension-context invalidation still has a local storage fallback

Next live validation:

- copy/load `1.5.43`
- update through Chrome extensions and hard reload Quora asset tabs
- run one visible retry candidate
- verify no `TEMP-DIAGNOSTIC`, `mbDiagnostic*`, or `mbdiag` fields/events appear on the fresh record
- verify action events are not duplicated in pairs

Validation completed locally:

- `node --check shared/js/content.js`
- `node --check shared/js/sw.js`
- `node --check shared/js/coordinator.js`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm test`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run prod`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:chrome`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:firefox`
- `git diff --check`
- verified the diagnostic strings are absent from `shared/`, `chrome/`, and `firefox/` built JS

Built artifacts:

- `chrome/mute_block-1.5.43.zip`
- `firefox/mute_block-1.5.43.zip`

## 1.5.48 De-Duped Run Accounting Fix

Status: complete and live-validated.

Problem found during multi-page validation:

- `1.5.47` handled near-sequential asset clicks with exactly one coordinator,
  but an all-merged enqueue created a run that stayed `active`
- example: `spamdetectives.quora.com` produced `Enqueued 0 new targets and
  merged 13`
- all 13 target rows were existing queue entries with older execution
  `runId`s, so the new run had `itemCount: 13` but no queue rows to count as
  active or terminal

Implemented in `1.5.48`:

- runs now store `targetProfileHrefs`
- service-worker run recomputation uses item `runId` plus the run target list
- coordinator display uses the same target-list accounting
- execution is still de-duped at queue-item level; the extra run tracking is
  only for source/run visibility and completion accounting

Validation:

- built and packaged `1.5.48` Chrome/Firefox artifacts
- pushed Chrome build to the Windows laptop and reloaded the unpacked extension
- extension manager reported `1.5.48` with zero runtime errors, warnings, or
  manifest errors
- live all-merged spam run completed with `targetCount: 1`
- live all-merged CrowdOut run completed with `targetCount: 3`
- source buttons ended at `Nuked`; queue had no active/queued items

Remaining note:

- old pre-`1.5.48` orphan run records can lack `targetProfileHrefs`; they are
  legacy state, not evidence that the new run accounting failed.

## 1.5.49 Source Reconciliation Fix

Status: built locally; live load blocked by tunnel loss.

Problem found during scrolled multi-page validation:

- after scrolling asset pages, queued fresh candidates from
  `spamdetectives`, `ummno`, `takingoutthetrash`, and
  `letsplaywhackatroll`
- the coordinator accepted the runs and kept a singleton coordinator tab
- source-page stale reconciliation then marked many coordinator-owned
  transient records as `interrupted` with
  `Pending queue state reconciled after stale queued work was found`
- this happened because source pages no longer own worker tabs, so their
  owner-status check does not prove coordinator-owned queue work is stale
- at the same time, visible per-post aggregate buttons could stay idle while
  the top button showed `Nuking...`

Implemented in `1.5.49`:

- scrolled per-post aggregate buttons show `Nuking...` when any currently
  detected entry is pending/busy
- source pages no longer perform age-only stale reconciliation of transient
  space-feed records
- explicit close/error/final states still reconcile

Validation:

- `node -c shared/js/content.js`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm test`
- `git diff --check`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run prod`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:chrome`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:firefox`

## 2026-05-10 1.5.76 Kicking Page-Type Fallback

Live symptom:

- after the `1.5.75` responsiveness fix, Kicking no longer false-labeled
  unrelated Instant Block work as active
- feed controls were still missing on the Kicking asset-space page
- an isolated content-script diagnostic showed `pageType: null`,
  `timestampCount: 18`, and `postLike: 192`

Root cause:

- Quora sometimes omits `.puppeteer_test_tribe_info_header` on space
  subdomain root pages
- when that marker is absent, `getPageType()` returns false/null and the
  scheduler exits before syncing feed controls, even though post markup is
  present

Fix:

- classify non-`www` Quora subdomain root pages as `space` when a cheap marker
  exists (`a.post_timestamp`, `.post_timestamp`, or the Tribe main page
  loadable resource)
- keep the `1.5.75` full-document-scan avoidance intact, so a viewport miss
  may temporarily show no controls instead of blocking Chrome

Follow-up in `1.5.77`:

- live reload with `1.5.76` captured no content-script exception, but Kicking
  still had no space-feed status/top/post controls after load
- root cause: if the initial startup sees no space markers, later mutations can
  make `getPageType()` become `space`, but the observer only scheduled feed
  sync for structural feed mutations
- fix: when an observed page is now a space and the space-feed status control
  is missing, schedule the feed-control sync even if the current mutation was
  not classified as a structural feed change

Follow-up in `1.5.78`:

- live reload with `1.5.77` still showed no controls and no exceptions after
  10 seconds; the page had the space header and timestamps, so there was no
  later mutation left to trip the observer path
- fix: add timed late-space follow-ups after startup and same-tab navigation;
  each follow-up cheaply checks `getPageType()`, and only if the page is now a
  space does it activate classification and feed controls
- this covers Quora pages that are not recognizable as spaces at content-script
  startup but become recognizable after their async header/feed render settles

Follow-up in `1.5.79`:

- live reload with `1.5.78` showed the late-space follow-up was reaching the
  page far enough to refresh/inject the category controls, but feed controls
  still never reached their dataset write
- likely blocker: `scheduleSpaceAssetNukeControls()` awaited the service-worker
  owned-work status before syncing feed controls; if that runtime message
  stalls, the page looks like it is still scanning forever
- fix: bound `get-owned-nuke-status` with a `2500ms` timeout and fall back to
  normalized zero owned work so the UI can render and later refresh

Follow-up in `1.5.80`:

- live reload with `1.5.79` showed the feed UI now renders, but Kicking stayed
  at `Scanning...` with `26` document timestamps and `0` visible entries
- root cause: during active pending work, `1.5.75` suppressed the full
  timestamp scan when viewport sampling missed; on Kicking, sampling can miss
  visible posts even though timestamps are in the viewport
- fix: keep the full-scan suppression, but add a bounded fallback that inspects
  at most `160` timestamp candidates and returns only those in the scan window

Artifacts:

- `chrome/mute_block-1.5.49.zip`
- `firefox/mute_block-1.5.49.zip`

Blocked live step:

- `1.5.49` has not been copied to the Windows laptop or loaded
- the copy attempt through `127.0.0.1:10022` hung and was killed
- subsequent probes to both copy `10022` and CDP `9223` timed out
- restart both tunnels before continuing live validation

## 2026-05-09 1.5.50-1.5.52 Coordinator Live Fixes

Status: built, pushed to Windows laptop, loaded in Chrome, and live-verified.

Fixes shipped:

- `1.5.50`: coordinator page renders stored queue state before awaiting
  service-worker announce/repair/resume work. This fixed a live coordinator
  page stuck at static `Loading` with zero counters while storage and worker
  tabs were active.
- `1.5.51`: successful space-feed profile confirmation asks the service worker
  to sync matching profile progress back into raw coordinator queue storage.
- `1.5.52`: service-worker resume/skip paths also sync successful profile
  progress before confirming space-feed post state. This fixed completed runs
  that displayed correctly through merged progress but left raw queue rows in
  `queued` or `active`.
- `1.5.81`: persisted active worker recovery now records worker tab ids in
  profile progress and reconciles old active/transient queue rows when the
  service worker has lost in-memory tab metadata. This targets the live
  `Joe-Goode-2` stuck-worker case where the profile renderer wedged, the tab
  was closed manually, and storage still claimed the row was active
  `tab-opening`.
- `1.5.82`: service-worker control messages from content/coordinator pages are
  bounded, and explicit storage repair returns before attempting queue resume.
  This keeps local progress/queue repair moving even when the worker is slow to
  answer runtime messages.
- `1.5.83`: stale persisted-active repair now ignores generic progress
  `updatedAt` and keys off actual worker-stage timestamps. This covers rows
  like `Vusal-Aliyev-35`, where normalization refreshed `updatedAt` even though
  the last real worker event was old.
- live result for `1.5.83`: loaded in Windows Chrome with zero extension
  errors; raw coordinator queue had no active/queued/settling rows after
  repair (`473` succeeded, `101` failed, `5` skipped, `3` canceled).

Live evidence:

- `1.5.50` two-source click test on `ummno.quora.com` and
  `takingoutthetrash.quora.com` produced exactly one coordinator tab and
  source buttons showed `Nuking... 8 left` and `Nuking... 5 left`.
- The same run exposed raw queue lag: the coordinator UI showed complete
  because it merged profile progress, but raw `mbCoordinatorQueue` still had
  successful rows in `queued`/`active`.
- `1.5.52` reload and coordinator open repaired raw queue storage to only
  terminal statuses: `succeeded: 254`, `failed: 127`, no raw `queued` or
  `active`.
- Chrome extension manager reported Mute Block `1.5.52` with zero runtime
  errors, zero runtime warnings, and zero manifest errors.

Validation:

- `node -c shared/js/content.js`
- `node -c shared/js/coordinator.js`
- `node -c shared/js/sw.js`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm test`
- `git diff --check`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run prod`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:chrome`
- `env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:firefox`
