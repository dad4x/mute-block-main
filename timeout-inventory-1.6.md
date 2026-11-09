# Timeout Inventory for 1.6

> **Status: REFERENCE** (24 Oct 2026). Timeout inventory (20 May). Stale; refresh after the timeouts registry merge. Reference or dated data. Check before relying on its numbers. Register: [notes register](docs/notes-register.md).

Status: current-source inventory after the 2026-05-19 recovery/repair review.

Canonical planning now starts at [planning.md](planning.md). Canonical
architecture starts at [architecture.md](architecture.md). Use this as the
timeout inventory that supports scheduler/storage work, not as a standalone
plan.

Scope: source files under `shared/js`. Generated `chrome/` and `firefox/`
outputs are intentionally ignored. Values below describe current behavior, not
the desired final scheduler design.

## Summary

The important timeout families are:

- service-worker queue deadlines, repair gates, and tab lifecycle cleanup in
  `shared/js/sw.js`;
- coordinator page request bounds and resume polling in `shared/js/coordinator.js`;
- content-script runtime message bounds, source-page refresh debounces, and
  worker-tab action waits in `shared/js/content.js`;
- Quora DOM/action waits for profile menus, confirmation dialogs, modal scans,
  and post-action verification.

The main architectural concern is no longer a single too-large timeout. The
current risk is policy scatter: recovery is triggered from startup, storage
change listeners, coordinator load, release paths, status reads, and alarms;
legacy `mbProfileNukeProgress` still feeds repair; and content-side action
loops still carry old foreground-fallback parameters even though promotion is
disabled. Timeout cleanup should follow ownership cleanup, not precede it.

## Service Worker Queue Deadlines

| Value | Source | Used for | Current justification | Review |
| --- | --- | --- | --- | --- |
| `10000ms` | `STALE_ACTIVE_QUEUED_TAB_MS` in `shared/js/sw.js` | Default stale timeout for active queued tabs that are not in background/opening, foreground-wait, or action phases. | Keeps a worker slot from lingering when no fresh progress appears. | Keep as a fallback only. Replace with explicit attempt leases once the scheduler owns job phases. |
| `45000ms` | `STALE_BACKGROUND_OPENING_QUEUED_TAB_MS` in `shared/js/sw.js` | Background worker has not reported `contentOpenedAt`. | Gives a new background tab time to load, inject the content script, and claim work. | Keep, but attach to durable `opening`/`claimed` state rather than metadata plus progress timestamps. |
| `35000ms` | `STALE_BACKGROUND_READY_QUEUED_TAB_MS` in `shared/js/sw.js` | Background worker has content open but no `actionReadyAt`. | Aligns with profile control readiness waits and avoids closing a slow Quora page too early. | Keep as a profile-ready lease, but make the lease explicit in job state. |
| `90000ms` | `STALE_ACTIVE_ACTION_QUEUED_TAB_MS` in `shared/js/sw.js` | Muting/blocking action phases for ordinary queued work. | Current code gives action work the same broad window as reverse cleanup. | Tactical. This is larger than the older inventory and should shrink once action leases and heartbeats are reducer-owned. |
| `90000ms` | `STALE_UNBLOCK_UNMUTE_ACTION_QUEUED_TAB_MS` in `shared/js/sw.js` | Reverse `unblock-unmute` action phases. | Reverse action can involve unblock, optional unmute, confirmation, route settling, and verification. | Keep until reverse retries move into scheduler-owned attempts. |
| `90000ms` | `STALE_FOREGROUND_WAIT_QUEUED_TAB_MS` in `shared/js/sw.js` | Worker waiting behind the durable action/foreground gate before `actionReadyAt`. | A worker that is waiting for the action lease is doing valid work, not merely idle. | Keep while the lease is metadata-backed. Move waiting into durable scheduler state and shorten after that. |
| `120000ms` | `COORDINATOR_ACTIVE_JOB_MAX_MS` in `shared/js/sw.js` | Wall-clock cap for a non-action active job. | Catches active rows whose heartbeat/stale anchors keep moving or are ambiguous. | Keep as a last-resort cap. It should become a per-attempt deadline. |
| `180000ms` | `COORDINATOR_ACTIVE_ACTION_JOB_MAX_MS` in `shared/js/sw.js` | Wall-clock cap for action-phase jobs. | Prevents an action attempt from occupying a slot indefinitely even with partial progress evidence. | Keep as a safety cap, not as primary scheduling policy. |
| `90000ms` | `ACTION_LEASE_MS` in `shared/js/sw.js` | Durable queue-row action lease expiry. | Serializes profile-menu/action execution across queued tabs. | This is the right ownership direction. Consolidate foreground/action waits around this lease and delete old promotion fallback plumbing. |
| `8000ms` | `STALE_CLOSE_REQUESTED_QUEUED_TAB_MS` in `shared/js/sw.js` | Tab has been asked to close but is still tracked. | Bounds close accounting after terminal or interrupted work. | Keep. This is cleanup policy, not a band-aid. |
| `1` retry | `STALE_QUEUED_TAB_MAX_RETRIES` in `shared/js/sw.js` | Internal stale active tab replacement retry. | Current code can requeue one stale active tab action. | Band-aid-shaped. Retrying should create an explicit new attempt id/number through the reducer, not reuse tab metadata cleanup logic. |
| `5000ms` | `FOREGROUND_LEASE_WAIT_EVENT_MS` in `shared/js/sw.js` | Progress event cadence while waiting behind an action/foreground lease. | Keeps stale repair from treating a waiting worker as dead. | Keep until lease waiting is durable job state. |

## Service Worker Repair and Resume Gates

| Value | Source | Used for | Current justification | Review |
| --- | --- | --- | --- | --- |
| `5000ms` | `STORED_WORK_REPAIR_INTERVAL_MS` in `shared/js/sw.js` | Periodic stored-work repair tick. | Reopens/restores the coordinator path when durable Current Work remains. | Keep, but route all repair scheduling through one named repair scheduler. |
| `1000ms` | Many `scheduleStoredWorkRepair(1000)` calls in `shared/js/sw.js` | Prompt repair after release, storage drift, resume, and coordinator events. | Coalesces likely follow-up work after mutations. | This is useful but scattered. Prefer one `repairStoredWork(reason)` entrypoint. |
| `15000ms` | `SPACE_FEED_STORAGE_UPDATE_TIMEOUT_MS` in `shared/js/sw.js` | Watchdog for serialized storage update queue. | Prevents one stuck storage update from blocking all later space-feed/job updates. | Keep. Rename or split once the queue is no longer only "space feed" storage. |
| `15000ms` | `COORDINATOR_REPAIR_GATE_TIMEOUT_MS` in `shared/js/sw.js` | Best-effort coordinator storage repair. | Hot paths should not wedge while trying to reconcile queue/progress/storage. | Keep as a guard, but reduce use after repair is centralized. |
| `15000ms` | `COORDINATOR_RESUME_GATE_TIMEOUT_MS` in `shared/js/sw.js` | Resume queued work from durable Current Work. | Bounds service-worker resume and live-tab adoption. | Keep. |
| `20000ms` | `COORDINATOR_STORED_WORK_RESTORE_TIMEOUT_MS` in `shared/js/sw.js` | Opening coordinator/restoring stored work. | Restore may open tabs, repair, and schedule queue execution. | Keep while restore opens UI; remove UI dependency from executor recovery over time. |
| `3000ms` | `COORDINATOR_JOB_MILESTONE_FLUSH_MS` in `shared/js/sw.js` | Deferred nonterminal job milestone flush. | Reduces storage churn while preserving progress. | Keep. This supports the log/fold performance approach. |
| `5000ms` plus `0.5min` alarm | `PERSISTENT_FAILED_RETRY_INTERVAL_MS` and `PERSISTENT_FAILED_RETRY_ALARM_PERIOD_MINUTES` in `shared/js/sw.js` | Persistent retry-failed mode. | Gives retry-failed mode a service-worker/alarm path instead of relying only on the coordinator page. | Keep, but retry eligibility and attempt creation should move fully into job-state policy. |
| `500ms` alarm delay | `COORDINATOR_RESUME_ALARM_NAME` scheduling in `kickCoordinatorQueueResume()` | Prompt background resume after dashboard or repair kicks. | Lets callers schedule work without waiting on execution. | Keep. This is better than making UI messages block on the executor. |

## Service Worker Tab and Message Cleanup

| Value | Source | Used for | Current justification | Review |
| --- | --- | --- | --- | --- |
| `250ms` | `schedulePersistOwnedTabIdsByParent()` in `shared/js/sw.js` | Debounce persisted owner-tab state writes. | Keeps recovery state fresh without writing on every bookkeeping mutation. | Keep. |
| `3000ms` | `sendTabMessage()` in `shared/js/sw.js` | Bound tab message delivery. | Prevents a stale or transitioning content script from blocking cleanup. | Keep. |
| `750ms` | `QUEUED_TAB_CONTENT_SCRIPT_CHECK_DELAY_MS` in `shared/js/sw.js` | Delayed content-script ensure after tab load completes. | Gives the browser a short window to attach the normal content script first. | Keep. |
| `5000ms` | `QUEUED_TAB_CONTENT_SCRIPT_ENSURE_TIMEOUT_MS` in `shared/js/sw.js` | Content-script probe/injection during queued-tab adoption/opening. | Prevents adoption/opening from hanging on scripting APIs. | Keep. |
| `2500ms` | `QUEUED_TAB_ACTION_CLAIM_NUDGE_TIMEOUT_MS` in `shared/js/sw.js` | Bound content-script claim nudge. | Avoids waiting forever for a worker tab to accept a claim. | Keep, but fold claim state into durable attempts. |
| `0, 250, 750, 1500ms` | `nudgeQueuedTabActionClaimWithRetries()` in `shared/js/sw.js` | Retry content-script claim nudges after injection/probe. | Covers content startup races. | Keep as startup compatibility; remove reload-on-unresponsive-marker behavior once claim handshakes are deterministic. |
| `5000ms` | `QUEUED_TAB_ACTIVE_TRANSITION_TIMEOUT_MS` in `shared/js/sw.js` | Transition a queue row to active after opening a tab. | Opening should not wait indefinitely on durable storage mutation, and content now receives an early queued-action nudge before this gate completes. A timeout keeps the live tab and schedules repair instead of closing a usable tab. | Keep bounded. Non-timeout transition rejection still rolls back; timeout leaves the tab alive for content claim/repair. |

## Coordinator Page Loops

| Value | Source | Used for | Current justification | Review |
| --- | --- | --- | --- | --- |
| `5000ms` | `COORDINATOR_RESUME_INTERVAL_MS` in `shared/js/coordinator.js` | Dashboard page periodically sends `resume-coordinator-queue`. | Keeps stored work moving while the dashboard is open. | Keep as UI assistance only. Runs must not depend on this page. |
| `5000ms` | `sendRuntimeMessageWithTimeout()` default in `shared/js/coordinator.js` | Page-ready, repair, and resume requests. | Prevents the dashboard from hanging if the service worker is waking or unavailable. | Keep. |
| `10000ms` | Coordinator actions such as requeue, retry, pause/resume, and cancel. | Longer bound for actions that inspect or rewrite Current Work. | Reasonable for operator commands. | Keep, but service worker should schedule execution rather than making the page wait for executor work. |
| `1000ms` | `scheduleCoordinatorStorageRepair()` in `shared/js/coordinator.js` | Debounced dashboard-requested repair. | Coalesces initial render/storage mismatch repair. | Keep until repair is entirely service-worker scheduled. |

## Content-Script Runtime Message Bounds

| Value | Source | Used for | Current justification | Review |
| --- | --- | --- | --- | --- |
| `12000ms` | `safeSendRuntimeMessageWithTimeout()` default in `shared/js/content.js` | Generic runtime request bound. | Historical broad fallback for heavier requests. | Too broad as a default. Prefer call-specific bounds. |
| `2500ms` | `QUEUED_PROGRESS_MESSAGE_TIMEOUT_MS` in `shared/js/content.js` | Nonterminal progress/milestone writes and most cleanup messages. | Keeps content pages from wedging behind slow service-worker responses. | Keep during compatibility; rely less on content-side progress mirrors later. |
| `5000ms * 3 attempts`, `250ms` gap | Terminal progress reporting constants in `shared/js/content.js` | Terminal job completion writes. | A worker tab should be patient before closing after a terminal action. | Replace with explicit worker-to-scheduler completion acknowledgement. |
| `2500ms`, then `500ms * 6`, then `5000ms` slow retries | Queued action claim constants in `shared/js/content.js` | Worker tab claims pending durable action after open/adoption. | Covers service-worker restart and content-script startup races. | Keep short-term. The durable queue row should own claim lifecycle. |
| `2000ms` | `QUEUED_ACTION_CLAIM_RESCUE_INTERVAL_MS` in `shared/js/content.js` | Periodic profile-page rescue when a pending queue row exists. | Lets a profile page claim work after missed nudges. | Useful but patch-shaped. Prefer service-worker claim nudges plus durable attempt state. |
| `5000ms * 3 attempts`, `350ms` gap | Queued profile-resolution message constants in `shared/js/content.js` | Resolver-only tabs report the resolved profile target. | Resolution may race with queue-row creation/storage. | Keep until resolver rows use first-class durable attempt state. |
| `8000ms` | `FOREGROUND_PROMOTION_MESSAGE_TIMEOUT_MS` in `shared/js/content.js` | Bound `begin-profile-action` requests. | Runtime calls into the action gate should not hang. | Keep, but rename away from "promotion"; this now gates action lease, not foreground promotion. |
| `90000ms` | `FOREGROUND_PROMOTION_LEASE_WAIT_MS` in `shared/js/content.js` | Old foreground-promotion wait. | The constant remains, but current code does not use it for action gating. | Delete or repurpose; stale constant name hides the newer action-lease design. |
| `45000ms`, poll `2500ms` | `ACTION_LEASE_WAIT_MS` and `ACTION_LEASE_POLL_MS` in `shared/js/content.js` | Wait for durable action lease, heartbeat, and post-lease readiness. | Prevents hidden workers from failing immediately while another tab owns the action gate. | Keep until lease waiting is driven from durable job state rather than content loops. |
| `5000ms` | `QUEUED_ACTION_HEARTBEAT_MS` in `shared/js/content.js` | Worker action heartbeat while long mute/block/unblock/unmute actions run. | Keeps service-worker stale repair aware of live action work. | Keep; eventually make this an explicit reducer heartbeat event. |

## Source Page Drain and Refresh Waits

| Value | Source | Used for | Current justification | Review |
| --- | --- | --- | --- | --- |
| `180000ms`, poll `1000ms`, sweep every `4000ms` | `waitForOwnedNukeTabsToDrain()` in `shared/js/content.js` | Compatibility wait for older source-page initiated nuke flows. | Gives UI feedback while owned tabs drain. | Retire or narrow as source-page settlement moves fully behind service-worker Current Work. |
| `12000ms` | `STALE_PROFILE_NUKE_PROGRESS_MS` in `shared/js/content.js` | Stale local progress handling. | Keeps stale transient progress from driving source-page labels indefinitely. | Keep only while `mbProfileNukeProgress` remains a compatibility mirror. |
| `5000ms`, `25ms` interval | `init()` waits for `document.body` in `shared/js/content.js` | Content script can start before body exists. | Prevents injection from running against a missing DOM. | Keep. |
| `80ms` | `scheduleSpaceFeedProgressReconciliation()` default. | Debounce pending-post/progress reconciliation. | Coalesces storage changes while keeping source labels responsive. | Keep. |
| `320ms` | `SPACE_FEED_PROGRESS_REFRESH_IDLE_MS` in `shared/js/content.js` | Space-feed progress refresh idle delay. | Avoids excessive feed rescans during rapid changes. | Keep. |
| `450ms` plus `120ms` grace | `SPACE_FEED_SCROLL_IDLE_MS` and `SPACE_FEED_SCROLL_REFRESH_GRACE_MS`. | Scroll-triggered feed refresh. | Avoids expensive feed scanning while the user is actively scrolling. | Keep. |
| `250ms` | `suppressSpaceAssetNukeRefreshUntil` after asset refresh. | Suppress self-triggered refresh loops after extension DOM updates. | Prevents immediate rescan churn. | Keep. |

## UI Injection and Page-Render Debounces

| Value | Source | Used for | Current justification | Review |
| --- | --- | --- | --- | --- |
| `400ms` | `scheduleProfileButtonsRefresh()` default. | Debounce profile button refresh. | Avoids fighting Quora DOM churn. | Keep. |
| `400, 1000, 2000, 3500ms` | `scheduleProfileButtonsFollowUps()`. | Follow-up profile button injection. | Quora profile controls often appear late. | Keep. |
| `50ms` then `20 * 250ms` | `ensureProfileButtons()`. | Retry profile button injection for about five seconds. | Covers delayed profile DOM without observing forever. | Keep. |
| `settings.fopDelay`, then `20 * 750ms` | `ensureQuestionPageFOPBtn()`. | Inject original-poster finder button. | Question pages load target controls asynchronously. | Keep; unrelated to queue recovery. |
| `1500, 4000, 8000, 12000ms` | Question page follow-ups. | Re-inject original-poster controls after late render. | Quora question pages mutate after route changes. | Keep. |
| `150ms` plus `800, 2000, 5000ms` follow-ups | Space-post button injection. | Inject late-rendered per-post nuke controls. | Quora post surfaces render asynchronously. | Keep. |
| `800, 2000, 5000, 10000ms` | Space page follow-ups. | Retry space page controls after late classification. | Space pages can become identifiable after startup. | Keep. |
| `120, 150, 180, 160ms` | Space classification/asset/viewport debounces. | Coalesce DOM mutations, asset scans, and viewport changes. | Prevents UI rescans from dominating page activity. | Keep. |

## Modal and Search Collection

| Value | Source | Used for | Current justification | Review |
| --- | --- | --- | --- | --- |
| `1000ms` | People/contributor modal loaded follow-up. | Wait after Quora reports a modal loaded before reading rows. | Modal rows can arrive just after the network event. | Keep. |
| `2000ms` | Profile followers/following modal loaded follow-up. | Longer wait before processing follower/following lists. | These lists render more slowly. | Keep. |
| `5000ms` | `profilesModalTimeout` fallback. | Continue opening profiles after a partially filled modal batch stalls. | Gives Quora time to append rows after scroll. | Keep for modal workflow. |
| `900ms` | Modal scroll wait. | Wait after synthetic scroll/wheel events. | Quora virtualized modals need time to load rows. | Keep. |
| `80` passes, `4` idle passes | `MODAL_PROFILE_NUKE_MAX_SCROLL_PASSES`, `MODAL_PROFILE_NUKE_IDLE_SCROLL_PASSES`. | Bound modal profile collection. | Prevents infinite virtualized-list scans. | Keep unless modal workflow becomes coordinator-native. |
| `120` passes, `6` idle passes, limit `100` | Profile search collection constants. | Bound profile-search collection. | Prevents infinite search-page scrolling. | Keep. |

## Worker Tab Readiness

| Value | Source | Used for | Current justification | Review |
| --- | --- | --- | --- | --- |
| `5000ms`, poll `250ms` | Worker waits for profile/security/unavailable page type. | Give navigation time to land on a profile or known failure page. | Detects bad redirects/security pages without hanging. | Keep, but represent as `opening` or `claimed` lease. |
| `25000ms` | `VISIBLE_PROFILE_READY_MS` in `shared/js/content.js`. | Visible worker waits for profile controls. | Quora profile controls can be slow even in visible tabs. | Keep as content readiness wait. Scheduler should own the corresponding lease. |
| `3500ms` | `HIDDEN_PROFILE_READY_FAST_PROBE_MS` in `shared/js/content.js`. | Hidden-tab fast probe before action lease waiting. | Avoids waiting 25s in a tab that probably needs the action gate. | Keep short-term. |
| `12000ms` | `HIDDEN_PROFILE_READY_NO_FOREGROUND_MS` in `shared/js/content.js`. | Hidden worker readiness when foreground fallback is disabled. | Allows hidden no-foreground actions a bounded readiness window. | Revisit after disabled foreground fallback is cleaned up. |
| `3500ms` | Queued unblock/unmute verification after action. | Confirm reverse action before terminal success. | Prevents false success on stale clicks. | Keep. |
| `2500ms` | Final queued mute/block blocked-state check. | Last chance to see blocked state before failing. | Captures delayed state transitions. | Keep as a terminal verification grace. |

## Profile Menu and Action Surface Waits

| Value | Source | Used for | Current justification | Review |
| --- | --- | --- | --- | --- |
| `4000ms`, `200ms` interval | `waitForAction()` and `waitForCondition()` defaults. | Generic short-lived DOM/action waits. | Bounded polling for Quora UI. | Keep helper defaults. |
| `4000ms`, `250ms` interval | `waitForConditionOrDomMutation()` default. | DOM mutation assisted condition wait. | Avoids pure polling for menu/verification surfaces. | Keep. |
| `2500ms` | `ensureProfileMenuOpen()` default. | Open profile overflow menu. | Should be quick once the action lease has been granted. | Keep, but delete disabled foreground fallback branches in this helper. |
| `1200ms`, `1800ms`, `2 attempts` | Keyboard/toggle retries inside `ensureProfileMenuOpen()`. | Try click, Enter, Space, Escape/toggle recovery. | Handles Quora menu flakiness. | Keep, but keep it local to menu opening and avoid adding scheduler policy here. |
| `1500ms`, first close window `600ms` | `closeProfileMenu()`. | Close menu with Escape/toggle fallback. | Closing should be quick. | Keep. |
| `8000ms`, `500ms` interval | `waitForProfileMenuState()` default. | Verify menu flips from action to inverse action. | Used for post-action verification. | Keep. |
| `5000ms` | Full mute/block/unblock/unmute menu option lookup. | Find expected menu action after opening menu. | Quora menu render can lag. | Keep, but depends on action lease cleanup. |
| `2000ms` | Best-effort unmute menu lookup. | Optional unmute cleanup after unblock. | Optional cleanup must not dominate reverse action. | Keep. |

## Reverse `Unblock Unmute` Action

| Value | Source | Used for | Current justification | Review |
| --- | --- | --- | --- | --- |
| `3` attempts | `maxReverseAttempts` in `unblockUnmuteProfile()`. | Retry blocked-profile reverse flow after transient failure. | Makes reverse cleanup repeatable against unreliable menus. | Most band-aid-shaped value. Replace with scheduler retry policy and explicit attempt ids. |
| `5000ms` | Canonical route wait. | Ensure profile URL has returned to canonical route before action. | Quora can route through noncanonical profile paths. | Keep. |
| `5000ms`, then `3000ms` retry | Unblock confirmation lookup. | Wait for confirmation, then retry by clicking unblock again if needed. | Covers slow/missed confirm surfaces. | Keep short-term; simplify after foreground/action lease cleanup. |
| `8000ms`, or `2500ms` if already done | Unblock verification. | Verify Block action or visibly unblocked state. | Avoids clearing persistent state before Quora state changed. | Keep. |
| `1500ms` full, `1000ms` best-effort | Unmute confirmation lookup. | Wait for optional unmute confirmation. | Optional unmute should not dominate unblock. | Keep. |
| `2500, 5000, 8000ms` | Unmute post-action verification windows. | Verify unmuted state across confirm/no-confirm/dismiss variants. | Quora may apply unmute through several surfaces. | Keep but simplify after interaction phase is scheduler-owned. |
| `750ms` | Inter-attempt reverse delay. | Let route/menu state settle before retry. | Tactical settling delay. | Move into retry policy or remove. |

## Mute and Block Action Waits

| Value | Source | Used for | Current justification | Review |
| --- | --- | --- | --- | --- |
| `2500ms` | Mute/block profile menu open. | Open profile overflow menu. | Should be quick after action lease. | Keep. |
| `5000ms` | Mute/block option lookup. | Find Mute or Block menu action. | Quora menu render can lag. | Keep. |
| `3000ms` | Block option lookup after reopening menu. | Second read after menu reopen. | Retry path should be faster after menu has rendered once. | Keep. |
| `8000ms` | Mute confirmation lookup. | Wait for Mute confirmation button. | Confirm surfaces can lag. | Keep. |
| `2500ms`, then `6000ms` retry | Mute confirmation close. | Retry confirm click if the dialog remains. | Avoids treating slow close as failure. | Keep. |
| `8000ms` | Mute applied verification. | Verify menu flips to Unmute. | Confirms the first half of mute/block. | Keep. |
| `8000ms` | Block confirmation lookup. | Wait for confirm or early blocked state. | Quora may apply block before a visible confirm is observed. | Keep. |
| `1500ms` | Early blocked menu-state check. | Detect block applied before confirm state resolved. | Avoids false failure. | Keep. |
| `5000ms` | Block mutation wait. | Watch for profile-block mutation after confirm click. | Mutation is faster evidence than text/menu polling. | Keep. |
| `2500ms`, then `6000ms` retry | Block confirmation close. | Retry confirm click if the dialog remains. | Avoids false failure on missed click. | Keep. |
| `8000ms`, fallback `6000ms` menu check | Block applied verification. | Confirm profile is blocked after action. | This is the destructive action success criterion. | Keep. |
| `3000ms` | Button removal after block. | Wait for local Mute Block button to disappear. | Keeps profile UI in sync. | Keep as UI polish. |

## Tab Close and Already-Blocked Follow-Ups

| Value | Source | Used for | Current justification | Review |
| --- | --- | --- | --- | --- |
| `3` attempts, `150ms` delay | `requestCloseTab()` default in `shared/js/content.js`. | Ask service worker/window to close a completed worker tab. | Closing can fail first through runtime or window API. | Keep. |
| `2` attempts, `100ms` delay | Common terminal/error close calls. | Faster close after known terminal/error state. | Cleanup should not block long after terminal state is recorded. | Keep. |
| `500, 1500, 4000, 10000, 30000, 60000ms` | Close-tab follow-up schedule. | Re-request close if first close attempt did not remove the tab. | Prevents orphan worker tabs after completion. | Keep until tab lifecycle is fully durable. |
| `0, 100, 250, 500, 1000, 2000, 4000, 8000ms` | Blocked-profile close checks. | Detect already-blocked profiles and close promptly. | Covers Quora pages that reveal blocked state at different render points. | Keep as compatibility cleanup. |

## Cleanup Priorities

1. Centralize repair scheduling in the service worker. Keep the existing time
   values initially, but make every repair trigger call one repair entrypoint
   with a reason instead of mixing `restoreCoordinatorPageForStoredWork()`,
   `repairCoordinatorStorageFromProgressBestEffort()`, `scheduleStoredWorkRepair()`,
   and queue resume calls throughout the code.
2. Make `mbCoordinatorQueue` the only repair authority. Convert
   `mbProfileNukeProgress` to a one-way compatibility mirror except for an
   explicit legacy-stranded-row migration.
3. Remove disabled foreground-promotion fallback branches and stale names.
   `promoteCurrentQueuedTab()` currently returns `false`; action gating now
   belongs to `begin-profile-action`/`ACTION_LEASE_MS`.
4. Move retry policy into durable job attempts. `STALE_QUEUED_TAB_MAX_RETRIES`
   and reverse `maxReverseAttempts` should create reducer-visible retry events
   with new attempt ids.
5. After those ownership changes, retune values from evidence. Shrinking
   timeouts before that will hide the real issue: scattered repair authority and
   mixed queue/progress ownership.
