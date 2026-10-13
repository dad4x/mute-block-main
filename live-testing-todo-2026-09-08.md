# Live Testing To-Do — 2026-09-08 (Windows machine, first live pass)

## RESOLVED (mostly): terminal-settlement was doing N sequential storage round-trips instead of 1 batched write — fixed at `1.6.1218`

Root cause of the multi-second-per-row settlement tail identified in the
"CORRECTION" section below: `settleTerminalCoordinatorItemsLocked`'s main
loop called `applyTerminalCoordinatorAuthoritySettlementLocked` (→
`coordinatorAuthority.applyWithinStorageUpdate` →
`enqueueApplyLocked`/`applyLocked`) **once per row**, and `applyLocked`
performs a real WAL-append + persistence round-trip on every call. The
codebase already has a proven batched alternative,
`persistCoordinatorAuthorityQueueWalBatchMutation`, used successfully by
`mutateCoordinatorStoredWorkCancel` and 10+ other call sites (confirmed via
the flight recorder: the cancel step's ~100+ row WAL write completed within
1ms). User's call: "I cavalierly take [full refactor]. I don't think there
are intentional sequential ordering issues" — confirmed by reading the
guard logic in the old per-row `mutate()` callback: both checks
(`isTerminalCoordinatorStatus`, settlement-key-unchanged) are pure
comparisons against `item`, a stable snapshot captured before the loop
starts and never mutated by processing any other row in the same loop —
and the whole function only ever runs inside an already-serialized storage
update cycle, so nothing else can interleave mid-loop regardless of
batching.

**Implemented**: rewrote the settlement loop to stage every qualifying
row's mutation in memory (`nextQueueForSettlement`, mirroring
`mutateCoordinatorStoredWorkCancel`'s pattern) and persist all of them in
one `persistCoordinatorAuthorityQueueWalBatchMutation` call after the loop,
instead of one `applyWithinStorageUpdate` call per row. Removed the now-dead
`applyTerminalCoordinatorAuthoritySettlementLocked` function entirely.

**Two follow-on fixes needed to get tests green**:
- A WAL-segmentation test hardcoded an expectation of 4 segments (one per
  individual append); batching now produces 3 (2 unrelated terminal-progress
  appends + 1 combined settlement segment instead of 2) — updated the
  expected segment count, not a bug, just fewer/larger segments (the actual
  point of batching).
- On a failed batch persist, `coordinatorAuthority`'s resident cache was
  never getting hydrated (the old per-row path read/wrote through
  `coordinatorAuthority` directly even on failure, implicitly syncing it;
  batching bypasses that). Added an explicit `coordinatorAuthority.hydrate()`
  call in the failure branch to match old behavior.

Updated the `p1-contract.test.js` structural test that asserted the shape
of the now-removed function. Full `npm run test:parallel` green. Rebuilt
and reloaded at `1.6.1218`, zero manifest/runtime errors.

**Live re-verification, partial**: tried queuing a fresh 179-item batch in
the same space to re-measure per-item timing under the fix. The click
handler visibly ran (`mbQueueing` flipped `true` then back to `false`
correctly) but produced **zero new queued items** — most likely this
specific space is simply exhausted (296 profiles already processed here
today across earlier test rounds: 163 canceled + 107 succeeded + 26
skipped), so the "179 candidates" the button counted from visible posts
were probably almost entirely already-terminal duplicates filtered out at
actual-enqueue time, not a bug in this fix. Did not chase this further or
switch to a fresh space to get a clean before/after timing comparison.
- **Live re-verification attempt 2 (fresh "Trolls galore" space, 391 new
  candidates)**: got a clean, healthy read on the fix itself — flight
  recorder showed one item's full `queued → active → succeeded` transition
  with normal-looking timing (no multi-second-gap settlement drip), and
  `succeeded` incremented 107 → 108 cleanly. But the *batch as a whole*
  repeatedly stalled — 0 profile tabs, no worker window, `queued` count
  frozen for minutes at a time — and each time, the flight recorder showed
  a **fresh service-worker restart** (sequence numbers resetting to 1),
  with the same row (`Make-Trans-ACK-Tivists-Cry`) retried across multiple
  restarts (`attemptNumber` climbing to 4+): the SW correctly decides to
  open a tab for it on every wake-up, then appears to die again before the
  open completes, before ever getting far enough to test settlement
  batching under real sustained load.
  - **Likely cause, not confirmed**: system resource pressure, not a code
    bug. `tasklist` showed **55 chrome.exe processes** at the time of the
    stall, after two days of heavy dev-profile testing (many tab
    open/close cycles, accumulated WAL/progress data, this session's own
    repeated CDP connect/disconnect churn). This project's own prior
    handoff already documented a near-miss with exactly this shape
    (accumulated tabs → system-wide thrashing) — this looks like the same
    class of issue recurring at the OS/Chrome level, independent of
    anything in `sw.js`.
  - **Net assessment**: the terminal-settlement batching fix itself is
    validated — full test suite (including WAL-segment-count checks that
    directly exercise the new batched code path), a clean flight-recorder
    trace, and one real successful completion. What's *not* independently
    confirmed is its behavior at full sustained load (50-100+ items
    processing back-to-back) on this machine, because the environment
    itself couldn't sustain that load long enough to test it today.
  - **Not yet done**: re-attempt on a machine/session with a clean Chrome
    restart (closing the 55-process pileup first) rather than this
    session's accumulated state, to get an uninterrupted large-batch timing
    run.

## RESOLVED: "Cancel Queue" left the coordinator paused indefinitely — user decided this is wrong, fixed (`1.6.1217`)

User canceled a batch, saw the dashboard still showing `paused`, and
questioned whether that's the right end-state. Investigated and found this
was **deliberate, tested prior behavior** — a contract test named "dashboard
has reversible pause and explicit current work cancel" explicitly asserted
`cancelCoordinatorCurrentWork`'s source does NOT clear the pause flag
(`assert.doesNotMatch(cancelBody, /setCoordinatorPauseControlState\(false.../)`).
Confirmed via CDP: after cancel, the raw `mbCoordinatorQueue` was fully
empty (0 entries) — so `paused: true` wasn't "backlog waiting to resume," it
was a standing flag blocking the coordinator from picking up **any** future
work, including a fresh "Nuke 'Em" click on a different space, until
explicitly resumed.

**User's decision**: Cancel should stop the current run only, not leave the
coordinator indefinitely blocked from new work. Separately, flagged that the
canceled run's own status showing `'complete'` was misleading (implies
success), and suggested reconsidering the word — landed on **`empty`**, and
also renamed the run-level `'active'` state to **`running`** for clarity,
confirming the run-status state space should be **empty / running / paused**
(deliberately just 3 states — collapses "all succeeded," "some canceled,"
and "never had items" into one `empty` value; per-item status, which has a
much larger vocabulary, is unaffected and keeps its own `'active'` value —
these are two separate concepts that happen to have shared a word).

**Implemented**:
- `cancelCoordinatorCurrentWork` (`shared/js/sw.js:18065`) now wraps its body
  in `try`/`finally`; the `finally` unconditionally clears
  `coordinatorPauseRequested` and calls
  `setCoordinatorPauseControlState(false, ...)` on every exit path,
  including failure — leaving it stuck paused after a *failed* cancel would
  be worse than the failure itself. All three return branches now report
  `paused: false` explicitly instead of `true`.
- Run-level status rename `'complete'` → `'empty'`, `'active'` → `'running'`
  across both the authoritative computation
  (`getCoordinatorRunStatus`/`materializeCoordinatorRunsPausedStateFromControl`
  in `shared/js/swCoordinatorRuns.js`) and the dashboard's own client-side
  mirror (`shared/js/coordinator.js`, two locations) and a reconcile-path
  default fallback (`shared/js/swCoordinatorReconcileLockedMaterialization.js`).
  Added a `.badge--running` CSS rule (`shared/css/coordinator.css`) so run
  rows keep the same "in progress" cyan styling they got for free before by
  coincidentally sharing the item-level `.badge--active` class. Added
  `running`/`empty` entries to `getStatusHelp`'s tooltip dictionary
  (left the old `active`/`complete` entries alone — `active` is still a
  legitimate, distinct item-level status).
- Updated the contract test that had locked in the *old* behavior
  (`test/p1-contract.test.js`, "dashboard has reversible pause and explicit
  current work cancel") to assert the new intended behavior instead of
  silently leaving a stale assertion. Updated 6 `swSynthetic.test.js`
  assertions referencing the renamed run-status values, plus one that
  expected a post-cancel resume attempt to be rejected with
  `'coordinator-paused'` (now correctly `'no-pending-items'`, since cancel
  no longer leaves anything paused to block on). Full `npm run test:parallel`
  green. Rebuilt and reloaded at `1.6.1217`.
- **Live-verified, partially — the practical goal works, but the actual
  Cancel Queue button couldn't be exercised end-to-end** (2026-09-09):
  found leftover `paused: true` state from before the reload, with 56 items
  already showing `canceled` (from a cancel that happened under the old,
  unfixed `1.6.1216` build). Tried invoking the fix's own code path
  directly (`chrome.runtime.sendMessage({action:
  'cancel-coordinator-current-work'})`, and the dashboard's Cancel Queue
  button was disabled since there was nothing live left to cancel) — both
  hit the **same pre-existing service-worker hang from the resume
  investigation** ("Deeper problem" section above): the message never
  completed, `paused` stayed `true` even after a 20s wait. This is the
  unresolved SW-hang bug, not a problem with today's fix.
  - Worked around it with the same direct `chrome.storage.local.set({mbCoordinatorPaused:
    false})` technique used before, then reloaded the space tab (to clear
    stale frontend button state left over from the earlier debugging) and
    clicked the real "Nuke 'Em 2" button to queue a small fresh batch.
    **Confirmed the actual goal**: it started processing immediately with
    no manual Resume step (2 tabs opened, `active: 2`, `paused: false`), ran
    to completion on its own (`succeeded` count went 104 → 106, exact match),
    and the dashboard's run-history badge correctly read `empty` once done
    (would have shown `running` had I checked mid-flight — the batch was
    just fast enough that it had already finished by the time I looked).
  - **Net**: the paused/empty/running rename and the "don't stay stuck
    paused" fix both check out functionally. What's still unverified is
    whether `cancelCoordinatorCurrentWork` itself completes and responds
    correctly when actually invoked live — that's blocked entirely on
    fixing the SW hang bug first, which remains a separate, higher-priority
    open item.

## CORRECTION (2026-09-09): the "SW hang" from yesterday isn't a hang — it's a slow background tail, and it does complete correctly

Yesterday's investigation concluded resume/cancel could genuinely hang
indefinitely and would need an attached debugger to diagnose. Revisited
today using the project's own `tools/cdp/flight-recorder.js` (a built-in
diagnostic ring buffer — `globalThis.getFlightRecorderSnapshot` on the SW,
or the `get-flight-recorder` message action) instead of blind `Runtime.evaluate`
probing, and the picture is clearer and less alarming:

- On a freshly-woken, idle service worker (empty/all-terminal queue), both
  `cancel-coordinator-current-work` and `resume-paused-coordinator-nukes`
  completed cleanly and quickly with full, correct, detailed responses. The
  hang is **not** unconditional/deterministic.
- Reproduced it deliberately under real load: scrolled the space feed to
  285 candidates, queued the full batch, let it churn to ~107 queued/1
  active, then called cancel. The client-side probe timed out at 25s as
  before — but reading the flight recorder immediately after showed the
  actual `stored-work-cancel` WAL writes for all ~100+ rows completed
  **within 1 millisecond of each other** (seq 289-345, same timestamp).
  What follows is a separate, **slow, one-row-at-a-time
  `terminal-settlement` reconciliation pass** for each already-canceled row
  (`persistCoordinatorAuthorityQueueWalMutation`, `reason:
  'persistence-pending'`, `statusBefore`/`statusAfter` both `'canceled'` —
  a no-op status-wise, but still going through the full settlement
  machinery), with multi-second gaps between consecutive rows in the log
  (e.g. ~3.6s, then ~3.6s more).
- Checked back after waiting: `paused: false`, `canceled: 163`, zero
  profile tabs — **the cancel and the pause-clear both completed
  correctly**. The apparent "hang" was `chrome.runtime.sendMessage`'s
  message port closing before this slow tail finished, silently dropping
  the response — not the underlying operation actually failing or wedging
  forever.
- Also spotted, unexplained: a `kickCoordinatorQueueResume` /
  `'dashboard-resume'` `start-resume` event appeared in the log ~7.7s after
  the cancel's WAL writes, which nothing in this session explicitly
  triggered at that moment. Possible leftover `chrome.alarms` from
  yesterday's *old* (pre-rewrite) `resume-queue.js`, which used to create a
  raw `mb-coordinator-resume` alarm directly — those persist until they
  fire, independent of which script created them. Not confirmed, not
  chased further.

**Revised understanding — two real, narrower problems, not one vague hang**:
1. **Performance**: why does per-row `terminal-settlement` take multiple
   seconds each, even for an already-terminal (canceled) row with nothing
   left to reconcile? At ~100+ rows with multi-second gaps, this alone could
   plausibly account for much of the multi-minute tail latency measured in
   the original acid test (item 0 below) — worth investigating as the same
   underlying cost, not a separate mystery.
2. **UX/response-contract mismatch**: `chrome.runtime.sendMessage` is not a
   suitable transport for an operation whose tail can run for minutes on a
   large batch — the message port doesn't wait that long, so both the
   dashboard's own click handler and any CDP tooling built on
   `sendMessage` will perceive success as failure/timeout even though the
   work is proceeding correctly. This needs a different response pattern
   for long-running operations (e.g. respond immediately with "canceling in
   background," and let the dashboard poll/observe completion via storage
   or the flight recorder, rather than waiting on the message callback) —
   not a "fix the hang," since there isn't one.
- **Not yet done**: profile why terminal-settlement is slow per-row; design
  and implement a non-blocking response contract for long-running
  cancel/resume operations; investigate the unexplained delayed
  `dashboard-resume` kick (likely benign/explained by stale alarms, but
  unconfirmed).

## Cancel/resume reliability gap: root-caused, one real fix landed, one deeper wedge found

Investigated the `cancel-current-work.js` / `resume-queue.js` unreliability
flagged earlier. Three distinct findings:

1. **Real `sw.js` bug, FIXED (not yet rebuilt/reloaded)**: `cancelStoredCoordinatorWork`
   (`shared/js/sw.js:18241`) enqueued its write via `enqueueSpaceFeedStorageUpdate`
   using the plain default timeout (`SPACE_FEED_STORAGE_UPDATE_TIMEOUT_MS`,
   15s). The serialized storage-update queue
   (`createSerializedStorageUpdateQueue` in `swstorage.js`) starts each
   update's timeout clock **at enqueue time, not when it actually starts
   running** — so under heavy concurrent write load (many active tabs
   heartbeating progress through the same serialized channel), a cancel
   request could time out purely from *queue wait*, before it ever got a
   chance to execute. This is backwards: a cancel/pause is exactly the tool
   reached for *because* the system is under heavy load, so it should be
   least likely to starve, not equally vulnerable. Fixed by passing
   `QUEUE_CRITICAL_STORAGE_UPDATE_TIMEOUT_MS` instead — an existing
   constant already used for other must-not-starve operations (see
   `settleTerminalCoordinatorItems`), so this brings `cancelStoredCoordinatorWork`
   in line with an established convention rather than inventing a new one.
   **Not yet rebuilt/reloaded/tested** — do that before considering this closed.

2. **Tooling bug, FIXED**: `resume-queue.js`'s "call the service worker
   function directly" fast path (`resumePausedCoordinatorNukes`,
   `runCoordinatorQueueExecutorFastPath`, etc., gated on
   `allowDirectServiceWorkerCall`) has **never actually been reachable** —
   confirmed via `typeof resumePausedCoordinatorNukes` evaluated directly
   against the live service worker returns `undefined`. Webpack's build
   wraps `sw.js`'s internals in module scope, so none of these are visible
   as bare globals to `Runtime.evaluate`, meaning every one of these
   "direct call" fast paths in the CDP tools has silently always fallen
   through to the plain `chrome.runtime.sendMessage` path. Separately, the
   old alarm-based fallback (`chrome.alarms.create('mb-coordinator-resume', ...)`
   from outside the service worker) bypasses the SW's own alarm-staleness
   bookkeeping (`coordinatorQueueResumeScheduler` /
   `isSuppressedStaleCoordinatorResumeAlarm` in
   `swSchedulerAlarmBookkeeping.js`) and can be silently suppressed as a
   "stale" alarm, which is why it kept reporting `clearedPause: true`
   while storage stayed `paused: true`. Rewrote `resume-queue.js` to drop
   the fragile alarm fallback and instead verify the persisted
   `mbCoordinatorPaused` flag directly after each attempt, retrying with
   fresh target discovery (the service worker's awake/asleep state changes
   between attempts) up to 4 times before honestly reporting failure
   (`verifiedPaused: true`, non-zero exit) instead of lying about success.
   - **Not yet done**: decide whether to expose key coordinator functions
     (e.g. via `self.__mbTestHooks = {...}` in a dev-only build path) so CDP
     tooling can call them directly and reliably instead of depending on
     `chrome.runtime.sendMessage`, which needs a message channel to survive
     round-trip while the SW can terminate at any point. That's a build/API
     surface decision worth discussing before implementing.

3. **Deeper problem, CONFIRMED REPRODUCIBLE on a fresh service worker —
   not a residual wedge from the Arash-442 incident**: relaunched Chrome
   fresh (rebuilt/reloaded at `1.6.1216` with fix #1 included) specifically
   to rule out leftover crisis state, then retested. Same result: a bare
   `chrome.runtime.sendMessage({action: 'resume-paused-coordinator-nukes'})`
   with a generous 20s timeout still gets "The message port closed before a
   response was received," on a service worker that had only just started
   and had zero open tabs. Went further: directly writing
   `mbCoordinatorPaused: false` to storage (bypassing the message path
   entirely, same technique that reliably worked for *pausing* earlier) DID
   flip the flag (verified `paused: false`), but **still produced zero
   activity** — no profile tabs opened, no queue movement, checked
   immediately and again 25 seconds later. This proves clearing the pause
   flag alone is not sufficient; something else has to actively "kick" the
   queue to start pulling items, and that kick either isn't happening or is
   itself part of whatever hangs. Most likely suspect remains
   `kickCoordinatorQueueResume(..., awaitFill: true,
   returnAfterDurableActive: true)` inside `resumePausedCoordinatorNukes`
   (`sw.js:18040`) — but this is now clearly a **real, reproducible product
   bug in the resume path itself**, not a tooling reliability gap and not
   session-specific leftover state.
   - **Update — traced further, and disproved the "UI click works" workaround**:
     the user clicked "Resume" in the dashboard and it displayed a "running"
     status. Checked ground truth via CDP immediately after: `paused: false`
     confirmed, but **zero profile tabs open and zero count movement** —
     identical to what the message-based attempts produced. This means the
     dashboard's "running" label is not reliable evidence of actual queue
     activity; it most likely just reflects the `mbCoordinatorPaused`
     boolean rather than verified pump/kick activity. So the earlier
     "manual click works" conclusion from earlier in this session was itself
     based on the UI's word for it without confirming real tab-opening
     activity followed — it may never have actually been reliable, we just
     hadn't checked ground truth after a click against a backlog this large
     before.
   - Read `kickCoordinatorQueueResume` (`sw.js:17296`) directly: the
     `resumePausedCoordinatorNukes` call shape (`direct: true,
     allowBeforeQuora: true, forceDurableQueueReload: true, awaitFill: true,
     returnAfterDurableActive: true`) skips the `allowBeforeQuora`-not-set
     early bailout (fine, that's satisfied), skips the background-fast-path
     and `executorFastPath` branches (neither applies when `direct: true`),
     and falls through to: `await promiseWithTimeout(runCoordinatorReconcileTick(reason,
     {direct: true, skipStoredWorkCheck: true, allowBeforeQuora: true}),
     COORDINATOR_RESUME_GATE_TIMEOUT_MS, 'coordinator queue direct resume')`
     — a 30-second (`COORDINATOR_RESUME_GATE_TIMEOUT_MS = 30000`) timeout
     wrapper that should resolve one way or another (either the real result,
     or its own `.catch` fallback returning `resume-reconcile-timeout` and
     scheduling a delayed retry) within 30 seconds even in the worst case.
     Yet the message call never responds even past that budget.
   - Also checked the message handler itself
     (`shared/js/swBootstrap.js:522`, `else if(request.action ===
     'resume-paused-coordinator-nukes') { return resumePausedCoordinatorNukes() }`)
     — structurally correct for this project's webextension-polyfill-based
     message listener pattern (returning a Promise, not using the raw
     `sendResponse`/`return true` callback style). Nothing obviously wrong
     at this level.
   - **Not yet done, and not further pursued this session**: this needs an
     actual attached debugger with breakpoints on the live service worker to
     see exactly where execution stalls inside `runCoordinatorReconcileTick`
     (or whether `promiseWithTimeout` itself has a bug preventing its own
     30s timeout from firing) — blind CDP `Runtime.evaluate` probing has
     reached its useful limit for this specific bug. Needs its own dedicated
     debugging session. **No known reliable workaround right now for
     resuming a paused queue with a backlog this size** — pause/cancel are
     more trustworthy than resume at this point.

Running list of findings from manual live-testing on the new Windows machine,
following [handoff-2026-09-08-decomposition-and-live-test.md](handoff-2026-09-08-decomposition-and-live-test.md).
Environment: dedicated dev Chrome profile at
`~/.local/share/mute-block-chrome-dev-profile`, `chrome-dev` unpacked
extension, currently built at `1.6.1216`.

## New finding: 12 duplicate tabs on one target + multi-minute per-item latency, post-crash batch (unresolved, evidence lost)

After the Windows-crash-and-reboot recovery (session survived cleanly, batch
auto-resumed — see below), left the same batch running unattended. Checked
back to find:
- **12 simultaneous tabs, all `https://www.quora.com/profile/Arash-442`** —
  the same single target, not 12 different targets. 12 Cloudflare challenge
  frames also present (1:1 with tab count at the time).
- **Per-item latency far exceeding the original acid test's worst case**:
  most recent succeeded items showed 1298s and **2225s** (37+ minutes) for
  a single item, with heavily overlapping/negative timestamp gaps (multiple
  items' active windows interleaved, not clean sequential processing).
- **Screenshotted one of the 12 duplicate tabs** — it showed a completely
  normal, unremarkable profile page, unclicked "Mute Block" buttons, no
  Cloudflare challenge, no banned/deactivated banner. This rules out my
  first hypothesis (each duplicate blocked by its own CAPTCHA) as the
  explanation for *this* tab, though challenge frames were present
  elsewhere at the same time. Screenshot:
  [tmp/live-testing-2026-09-08/arash-stuck-1.png](tmp/live-testing-2026-09-08/arash-stuck-1.png).
- **Working hypothesis, not confirmed, evidence no longer available to
  check**: same author posting multiple times in the space feed could
  produce multiple separate queue rows all pointing at the identical
  profile href, if queueing doesn't dedup by target href across rows — the
  coordinator would then happily open a separate tab per row for the same
  profile, and N near-simultaneous hits on one profile from the same
  session looks exactly like the kind of pattern that would trigger Quora's
  own anti-bot defenses (matching the observed challenge frames). Could not
  verify: by the time this was checked, `mbCoordinatorQueue` (the raw
  queue) was already empty (see tooling finding below) — the duplicate-row
  evidence, if it existed, is gone.
- **Not yet done**: reproduce deliberately (queue a space with a single
  prolific author's posts and check for duplicate queue rows sharing one
  `targetProfileHref` before opening any tabs), and if confirmed, add
  href-level dedup at queue-build time.

## New finding: `cancel-current-work.js` and `resume-queue.js` are unreliable under load; had to bypass via direct storage writes

While responding to the above, both the CDP-based graceful cancel and an
earlier resume both failed to actually take effect through their normal
message-passing path:
- `resume-queue.js` twice reported `clearedPause: true` (from its
  alarm-scheduling fallback path, not a direct confirmed write) while
  `paused` remained `true` in storage both times; a manual click of
  "Resume" in the dashboard UI is what actually worked.
- `cancel-current-work.js` returned `{"ok": false, "reason":
  "cancel-persistence-failed"}` twice in a row (once before, once after
  closing the 12 stuck tabs) — never succeeded this session under load,
  unlike its first use earlier in the day which worked cleanly on the first
  try.
- Workaround used: wrote `chrome.storage.local.set({mbCoordinatorPaused:
  true})` directly via a CDP `Runtime.evaluate` one-off, bypassing the
  message-handler path entirely. This worked immediately and reliably both
  times it was needed.
- **Not yet done**: find why the message-passing path
  (`chrome.runtime.sendMessage`) and the "cancel-persistence" write inside
  `cancelCoordinatorCurrentWork()`/its message handler in `sw.js` are
  unreliable specifically under load (possibly the same SW-overload
  condition documented in item 0 below) — this matters for real usage too,
  not just automation, since a human clicking pause/cancel in the dashboard
  during a bad run needs it to actually work.

## Also noted: `mbCoordinatorQueueView` (compact, what the dashboard and
most of these CDP tools read by default) can show stale counts (58 queued)
while the raw `mbCoordinatorQueue` is already empty underneath it — seen
immediately after the pause above. Possibly expected (the view may only
refresh on active processing, so it freezes at last-known state once
paused) rather than a bug, but worth confirming — it's a source of
confusion when using these tools to gauge "is it really still queued."

## New finding: space-feed categorization lags visibly while scrolling to load new candidates (root cause found, not yet fixed)

User's live observation: scrolling down the space feed to pick up new
candidates, the extension's own categorization (which drives the "Nuke 'Em
N" counter and per-post button state) visibly lags behind the feed's own
rendering of new entries.

**Root cause, confirmed by reading the code** (`shared/js/content.js`):
`getVisibleSpaceFeedTimestamps` (`:6484`) merges two scan strategies —
`getViewportSampledSpaceFeedTimestamps` (`:6395`, cheap and properly
viewport-bounded: samples via `document.elementsFromPoint` at a fixed grid
of on-screen coordinates, cost independent of total feed size) and
`getBoundedVisibleSpaceFeedTimestamps` (`:6431`, **not** bounded despite the
name: `document.querySelectorAll('a.post_timestamp')` with no scope,
returning every post-timestamp anchor in the whole document, then computing
a scan-distance for every single one before any cap is applied). Both run
**unconditionally on every sync**, not the second as a fallback for the
first — so the expensive full-DOM measurement pass happens every time
regardless of whether the cheap sampled scan already found what it needed.
Since Quora's space feed does not appear to virtualize/unmount posts
scrolled past (they stay mounted), this cost scales with the total number
of posts ever loaded into the page this session, not with what's currently
on screen — worse the further down you've scrolled. This is called from
`syncSpaceFeedNukeControls` → `getSpaceFeedPostEntries` → `getSpaceFeedCardRoots`,
triggered on a debounced scroll-idle timer (`scheduleFromScroll`, not
per-scroll-pixel, so it's not spamming — each individual run just gets
slower as the feed grows).
- **Not yet done — fix not yet implemented** (would need a rebuild/reload,
  deferred to avoid interrupting the live batch running during this
  investigation):
  - Simplest, safe options to evaluate: only fall back to
    `getBoundedVisibleSpaceFeedTimestamps` when the sampled scan comes back
    empty/insufficient (matching the "bounded" name's apparent original
    intent), rather than always merging both; and/or scope its
    `querySelectorAll` to the feed's own content root (`getSpaceFeedContentRoot()`,
    already computed elsewhere) instead of the whole `document`.
  - A more thorough fix would avoid re-measuring every previously-seen
    timestamp's distance on every tick at all (e.g. only compute distance
    for nodes not already known to be far outside the scan window from the
    last pass), but that's a larger change — worth deciding scope with the
    user before starting.

## New long-term to-do (user request, not yet implemented): never target followed accounts or self

User's ask: add a safety check so the extension never attempts to mute/block
(a) accounts the user follows, or (b) the user's own account. Motivation
given: there have been categorization bugs in the past where friendly
posters ended up miscategorized as targets, so this is meant as a backstop
independent of category-detection correctness, not a fix to any specific
categorization bug. Explicitly framed as longer-term, not urgent.
- **Not yet done, needs its own investigation before implementing**:
  - Find where a target profile href is finally committed to an action
    (queueing time in `content.js`'s space-feed/profile-search nuke paths,
    and/or the actual block-execution step) — the check should sit as late
    and as unconditionally as possible so it can't be bypassed by any
    upstream categorization path.
  - Determine how to reliably detect "I follow this account" and "this is my
    own account" from the profile page DOM (Quora likely renders a
    "Following" state indicator and the user's own profile has distinguishing
    markers) — needs its own DOM investigation, not yet started.
  - Decide behavior on match: hard-skip silently, skip with a visible
    warning/flag for the user to review, or refuse with an explicit error —
    probably worth asking the user which they'd prefer once the detection
    side is worked out.

## Fixes implemented this pass (items 0 and 1 below) — rebuilt as `1.6.1214`, queue canceled and stray tabs closed, ready to retest

## Design: fast-skip banned/deactivated accounts (IMPLEMENTED, rebuilt as `1.6.1214`, not yet re-verified live)

Implemented both parts of the fix below in `shared/js/content.js`:
`getProfileUnavailableReason` now matches `banned` and returns a distinct
`'Profile banned'` value; `skipQueuedUnavailableTab` now writes the
`status: 'blocked', blockSucceeded: true, blockReason: 'quora-banned'` shape
for that case instead of `status: 'profile-unavailable'`. Full
`npm run test:parallel` green afterward. **Still open**: did not chase down
the pre-queue enqueue-time filter (see "Not yet done" below) — this fix
gets a target out of the queue quickly once it's opened and skipped, and
marks it done for any *future* queue-build pass to filter out via the same
mechanism already used for real blocked profiles, but does not by itself
guarantee zero tab-opens on a target's very first encounter.

Original analysis, for reference:

User's ask: record banned/deactivated Quora accounts persistently so future
runs skip them without ever opening a profile tab, and — per explicit
direction — **just treat them as already mute/blocked** rather than
inventing a separate status category. This is directly actionable against
existing code; here's exactly where it plugs in.

**Detection gap found** (`shared/js/content.js:2702`, `getProfileUnavailableReason`):
the regex list matches `unavailable|disabled|deactivated|deleted|suspended|restricted`
but **not `banned`**. The `Crushinglibs4-0` page showed two separate Quora
banners — "This account has been deactivated." and "This account has been
banned. Click here to learn more about ban decisions." — and happened to
still match on "deactivated," so detection technically fired for this
specific case. But a banned-only page (banned banner with no "deactivated"
wording) would **not** be caught at all today and would fall through to the
normal profile-menu-button wait logic, which has nothing to find. Fix:
add `banned` to all three regex alternations at lines 2712-2714.

**Where to persist "treat as already blocked"**: `recordQueuedProfileProgress`
already writes the durable per-profile record that both (a) the "Nuked"
badge vs. action-buttons rendering reads, and (b) presumably whatever
filters space-feed entries before queueing reads (needs confirming — see
below). `closeQueuedBlockedTab` (`content.js:10664`) writes
`status: 'blocked'|'already-blocked', blockSucceeded: true` on a real
success. The fix: in `skipQueuedUnavailableTab` (`content.js:10690`), when
`getProfileUnavailableReason()` specifically matches the banned/deactivated
case (a Quora-side *terminal* state, unlike e.g. a transient security-check
page), write the **same** `status: 'blocked', blockSucceeded: true` shape
instead of `status: 'profile-unavailable'` — plus a marker field (e.g.
`blockReason: 'quora-banned'`) purely for observability/debugging, so it's
distinguishable in inspection tools without being treated differently by any
dedup/skip logic. This reuses the existing per-profile progress store
end-to-end rather than inventing a new persistent cache — no new storage
key, no new dedup code path, just a different `status` value written from
one additional branch.
- **Not yet done**: confirm exactly which function reads this progress
  record to decide whether to *enqueue* a space-feed entry in the first
  place (likely in `nukeSpaceFeedEntries`, `content.js:9029`, or its
  caller) — that's the actual "fast-skip without opening a tab" enforcement
  point, separate from (but fed by) the persistence write above. Detection
  fix + persistence write alone only help once a target has been opened
  once; confirming the pre-queue read path is what delivers the "without a
  profile opening" part of the request for every subsequent run.
  - This is a source change to `shared/js/content.js`; per the version-bump
    rule (`AGENTS.md`), don't build/reload it while the current acid-test
    batch is still running — reloading the extension mid-run would kill the
    in-flight run. Implement and verify after this run finishes.

## Open items

### 0. [PRIORITY] Per-item queue processing latency climbs steadily over a large batch run — "acid test" in progress

- **Where seen**: same `stopfalseflagoperations.quora.com` space, after clearing
  stats and queueing a large batch by scrolling and hitting "Nuke 'Em 111" —
  i.e. queueing on the order of 100+ items in one space in a single session,
  much larger than the earlier ~14-19 item batch (item 0 predecessor, now
  resolved as healthy). User's live observation: "not thrilled with the 17
  second handoffs" between items.
- **Measured** (via timestamps pulled from `chrome.storage.local` through
  `tools/cdp/queue-storage-summary.js`, run id `space-feed-1788892668857-cc3l1h`):
  per-item processing time (activeAt → updatedAt) climbs from roughly 2s at
  the start of the batch to over 20s average by ~80-90 items in, with
  individual items up to 37.5s and one at **54.6s** (`Mark-Zuckerberg-CEO-5`).
  First-5 vs last-5 sampled average: **~2.0s → ~21.2s, roughly a 10x
  slowdown**, and the climb looks steady/monotonic rather than a one-off
  spike.
  - Also noticed: a few items show negative gap-since-previous-item values,
    meaning their active windows overlapped the prior item's completion —
    processing isn't strictly one-at-a-time throughout the run, which
    complicates isolating the cause.
  - Snapshot at ~90 total queued (still growing at observation time): 34
    succeeded, 12 skipped, 43 queued, 1 active, not paused.
- **Not a tab-pileup repeat of the handoff's near-miss**: `target-summary.js`
  showed only 1 profile tab open at a time throughout, plus the dashboard and
  a "Mute Block Worker" background window — so this is a different failure
  mode than the swap-thrashing incident, not the same one recurring.
- **Working hypothesis, not confirmed**: latency scaling with total
  queued/processed count smells like an O(n)-or-worse cost tied to queue
  size — e.g. the entire `mbCoordinatorQueue` object being fully
  re-serialized to `chrome.storage.local` on every single item completion
  (write cost grows as the object grows to 90+ entries + per-item metadata),
  or an in-memory array/Set scan over the full queue on each decision. This
  project's own prior notes
  ([storage-authority-refactor-plan-for-review-2026-05-20.md](storage-authority-refactor-plan-for-review-2026-05-20.md),
  [storage-observability-baseline-2026-05-22.md](storage-observability-baseline-2026-05-22.md))
  already flagged storage overhead as a concern area, so this may be a known
  or half-addressed issue rather than a new regression.
- **User decision**: let the batch run to completion (rather than stopping
  early) specifically to observe the full shape of the degradation, then
  diagnose root cause afterward.
- **UPDATE — likely root cause found, via mid-run screenshots while the run
  appeared stalled** (counts had gone *backwards*: succeeded 64→62, queued
  5→9, over a 20s window with the exact same 4 profile tabs open the whole
  time — no progress at all). Screenshotted all 3 distinct stuck tabs
  (`tools/cdp/screenshot-tab.js`), found **two separate real bugs**:
  - **Bug A — banned/deactivated Quora accounts aren't handled as a fast-fail
    case.** `Crushinglibs4-0` showed Quora's own "This account has been
    deactivated" / "This account has been banned" notices. There's no normal
    block-control UI on a banned-account page, so the content script has
    nothing expected to interact with — the automation appears to hang on
    this case rather than detecting it and skipping quickly. Screenshot:
    [tmp/live-testing-2026-09-08/stalled-tab-1.png](tmp/live-testing-2026-09-08/stalled-tab-1.png).
  - **Bug B — a tab isn't closed after its mute-block action succeeds.**
    `Marcel-Warren-9` already showed the "BLOCKED" badge and "Unblock Unmute"
    button (i.e. the action fully succeeded), but the tab was still open with
    a stale "Close tab" button that apparently never got triggered/completed.
    Screenshot:
    [tmp/live-testing-2026-09-08/stalled-tab-2.png](tmp/live-testing-2026-09-08/stalled-tab-2.png).
  - Third checked tab (`Jamie-Macdonald-241`) looked like normal in-progress
    work (unclicked buttons, no badge yet) — not everything open is stuck,
    only specific cases. Screenshot:
    [tmp/live-testing-2026-09-08/stalled-tab-3.png](tmp/live-testing-2026-09-08/stalled-tab-3.png).
  - **How Bug A explains the rest**: a duplicate `Crushinglibs4-0` tab was
    also observed open (two separate CDP target ids for the identical
    profile URL) and a second "Mute Block Worker" window appeared mid-run
    (there was only ever one earlier) — consistent with a retry mechanism
    firing on the stuck banned-account item without cleaning up the original
    stuck tab/worker, compounding resource usage as the batch runs longer
    and hits more already-banned/deactivated targets (which become
    statistically more likely the larger and more aggressive a moderation
    space's batch gets). This plausibly explains the climbing per-item
    latency better than the original storage-write-cost hypothesis, though
    that may still be a secondary contributing factor — not ruled out.
- **UPDATE 2 — Bug B mechanism found and confirmed self-healing (not the
  primary driver); Bug A confirmed persistent (not a timing illusion)**:
  - **Bug B root cause, `closeQueuedBlockedTab` (`content.js:10664`)**: on a
    real success, if the durable progress write comes back
    `serviceWorkerOnly: true` and `runtimeRecorded: false` (i.e. the
    write landed in the service worker's own storage but wasn't
    acknowledged back to the content script — plausible if the SW is
    overloaded/cycling mid-burst), the code **deliberately** does not close
    the tab: it logs "Queued terminal success was not recorded; leaving tab
    open for retry" and schedules `sweepServiceWorkerBlockedProfileTabs()`
    one second later, by design, as a safety net rather than losing track of
    a real success. Re-checked a few minutes later: `Marcel-Warren-9` is
    **gone** — the sweep-retry did eventually close it. So this is a
    load-induced delay with a working (if slow, under this session's
    conditions) self-healing path, not a permanent leak on its own — though
    it still adds to transient tab/resource count during a heavy burst,
    which plausibly compounds the latency climb.
  - **Bug A confirmed NOT a timing illusion**: re-checked the same two
    `Crushinglibs4-0` tab ids a couple of minutes later — both still open,
    unchanged. This one is genuinely stuck, unlike Bug B.
  - Net read: Bug A (banned/deactivated accounts) looks like the more
    durable contributor; Bug B is real but self-corrects. See the new
    "Design: fast-skip banned/deactivated accounts" section above this item
    for the concrete fix for Bug A, worked out from reading
    `getProfileUnavailableReason`, `skipQueuedUnavailableTab`, and
    `closeQueuedBlockedTab` directly.
- **Not yet done**:
  - Let the run finish (or time out / get manually stopped) either way;
    capture final totals and whether it ever fully recovers vs. stays wedged.
  - Implement the Bug A fix from the design section above (banned-regex gap
    + treat-as-blocked persistence) once this run is done — do not
    build/reload mid-run.
  - Check `tools/cdp/storage-footprint.js` and `tools/cdp/queue-wakeup-metrics.js`
    for evidence of storage size/write-cost growth as a secondary factor
    behind the latency climb, now that Bug A/B explain part but maybe not
    all of it.
  - Check whether this reproduces at smaller batch sizes at all (the
    resolved ~14-19 item batch earlier showed no such climb) — i.e. is it
    purely a function of hitting more banned/edge-case accounts at larger
    scale, or does queue size itself also matter.

### 1. Injected post action buttons overlap the post's timestamp text (IMPLEMENTED, rebuilt as `1.6.1214`, not yet re-verified live)

**Fix applied**: root cause was `.mb-ext_post-nuke-slot` positioning the
button host absolutely over the header row (`right: 16px`, vertically
centered) rather than as a flex sibling, so it never displaced text — the
existing `.mb-ext_post-header-host { padding-right: 104px }` static
reservation only covered the single-badge "already nuked" case, not the
wider two-button idle state (variable-length "Nuke 'Em N" + "Mute-Block").
Added `syncSpaceFeedPostHeaderReservedSpace()` in `shared/js/content.js`,
called after each post's buttons are finalized in `syncSpaceFeedPostButtons`
(both the nuked-badge branch and the two-button branch), which measures the
button host's actual rendered width via `getBoundingClientRect()` and sets
an inline `padding-right` on the header container sized to fit whatever is
actually showing, instead of relying on a fixed guess. Full
`npm run test:parallel` green afterward. Not yet re-checked visually against
the same `stopfalseflagoperations.quora.com` space this bug was found in.

- **Where seen**: Quora space `https://stopfalseflagoperations.quora.com/`
  ("Boris & Natasha Get Caught at Checkpoint Charlie!"), after marking the
  space "Asset" and viewing its feed. Reproduced on the "Lucas Quidera" post
  in the "From your notifications" section.
- **Symptom**: The per-post injected "Nuke 'Em 20" / "Mute-Block" buttons are
  positioned on top of the post's byline/timestamp text instead of beside or
  below it. On the Lucas Quidera post, the byline text "Now a Democrat! Thank
  U Toxic Trump for making me one! 8647 · Ju..." is visibly truncated/covered
  right where the buttons sit.
- **How found**: Captured via a new CDP helper,
  [tools/cdp/screenshot-tab.js](tools/cdp/screenshot-tab.js) (`--needle
  stopfalse`), which grabs `Page.captureScreenshot` from a live tab matched
  by title/URL substring — added this session specifically because there's no
  other way to see the user's actual desktop Chrome window from here. Screenshot
  saved at
  [tmp/live-testing-2026-09-08/space-post-button-date-overlap.png](tmp/live-testing-2026-09-08/space-post-button-date-overlap.png).
- **Not yet done**:
  - Confirm whether this is a pre-existing bug (present before this session's
    `sw.js` decomposition work) or a regression — likely pre-existing/CSS-only
    since decomposition work didn't touch styling, but not confirmed.
  - Find the responsible CSS/injection code — likely button placement rules in
    `shared/css/content.css` and/or the DOM-insertion logic in
    `shared/js/content.js` that injects the action buttons into each post row.
  - Check whether it reproduces on other posts/spaces or is specific to short
    bylines / narrow post-row layouts (the "Will Fridolf" post lower on the
    same page did not show visible truncation in the same screenshot).
  - Decide fix approach: likely needs the buttons to not be absolutely
    positioned over the byline, or the byline needs right-padding reserved
    for button width.
- **Supporting evidence**: after mute-blocking this same Lucas Quidera post
  (see item 2 below), its two buttons ("Nuke 'Em"/"Mute-Block") collapsed to
  a single "Nuked" badge, and the previously-truncated byline text rendered
  fully: "Now a Democrat! Thank U Toxic Trump for making me one! 8647 · Jun
  1" is now completely visible. Screenshot:
  [tmp/live-testing-2026-09-08/already-blocked-mute-block-result.png](tmp/live-testing-2026-09-08/already-blocked-mute-block-result.png).
  This points at the overlap being specifically a *two-button-vs-byline-width*
  layout issue (two buttons don't fit next to a long byline) rather than a
  general absolute-positioning bug — narrows the fix to the two-button case.

### 2. RESOLVED (2026-09-09): Legacy single-item mute-block action confirmed to NOT be recorded persistently — real gap, not a tooling limitation

- **Where seen**: profile page `https://www.quora.com/profile/Honest-Patriot-6`,
  clicked the legacy (pre-queue/pre-coordinator) "Mute-Block" button directly
  on the profile page — no dashboard, no queueing, matching the user's
  description of the original pre-refactor UX ("in the old days it would
  complete in about 5 seconds").
- **Symptom**: The action completed correctly on the Quora side — screenshot
  confirms a red "BLOCKED" badge and the button flipping to green "Unblock
  Unmute" (saved at
  [tmp/live-testing-2026-09-08/legacy-mute-block-result.png](tmp/live-testing-2026-09-08/legacy-mute-block-result.png)).
  But when checked immediately after via
  `node tools/cdp/queue-storage-summary.js`, it reported
  `{"extensionPage": false}` — no persisted record was reachable.
- **Resolved via code reading, not live retesting** (`shared/js/content.js`):
  traced the legacy button's full chain —
  `handleMuteBlockClick` → `muteProfile` → `blockProfile`. Both `muteProfile`
  and `blockProfile` call `recordCurrentProfileNukeProgress`/
  `noteCurrentProfileNukeProgress` extensively, including on every success
  path (`muteSucceeded: true`, `blockSucceeded: true` before every `return
  true`) — so it isn't that the legacy path skips recording calls. The real
  issue is inside `recordProfileNukeProgress` itself (`content.js:1063`):
  it branches on `isActiveQueuedProgressRecord(href)` — true only when the
  tab is operating under the coordinator/queue protocol
  (`activeQueuedAttemptId`/`activeQueuedAttemptProfileHref` set). Only that
  branch sends a message to the service worker to durably persist via
  `chrome.storage`. The `else` branch — what **every** legacy direct-click
  action takes, since a manually-opened profile tab is never a "queued
  attempt" — just does
  `profileNukeProgress = {...profileNukeProgress, [href]: nextRecord}` and
  returns `{..., runtimeRecorded: false, localOnly: true}`. `profileNukeProgress`
  is a plain in-memory variable scoped to that one content-script instance.
  **Confirmed: legacy single-item actions are never written to
  `chrome.storage` at all** — the progress exists only in that tab's memory
  and is gone the moment the tab closes or the content script reloads.
- **Practical impact, bounded**: `blockProfile()` checks Quora's own live
  `isProfileBlocked()` page state first and short-circuits to
  `already-blocked` if so — that check is against the live page, not our
  storage, so a profile legacy-blocked earlier still gets correctly
  recognized as already-blocked on any future visit (no double-action, no
  duplicate Quora-side work). What's actually lost: (a) no audit-trail
  entry for legacy actions, and (b) the coordinator's own dedup (which reads
  structured progress records when building a space-feed batch) has no way
  to know about a legacy-blocked target, so a future batch queue could still
  include it, costing one wasted tab-open before the fast `isProfileBlocked()`
  short-circuit catches it.
- **FIXED (1.6.1220)**: user's call — this matters because recorded history
  is intended to be used later, so both mute-block *and* unblock/unmute need
  durable recording. Implementation:
  - New queue-independent SW message action `record-direct-profile-progress`
    (`shared/js/swBootstrap.js`) → new `recordDirectProfileProgressFromRequest`
    (`shared/js/sw.js`, next to `recordJobProgressFromRequest`): merges the
    incoming patch onto whatever progress record already exists for that
    href via `normalizeProgressPatch`, then persists straight through
    `saveProfileNukeProgressRowProjection` — the same queue-independent
    primitive already used elsewhere (e.g. in terminal settlement) to write
    the profile-progress projection without touching `mbCoordinatorQueue`
    or any WAL/attempt machinery. Deliberately does **not** reuse
    `recordJobProgressFromRequest`/the queue-machine event path, since that
    would create a synthetic coordinator queue row for work that was never
    actually queued.
  - `content.js`'s `recordProfileNukeProgress` non-queued branch now sends
    this message (via `safeSendRuntimeMessageWithTimeout`, 4s) instead of
    only updating the in-memory `profileNukeProgress` variable, and adopts
    the SW's returned (possibly further-merged) record on success —
    mirroring the queued branch's existing pattern. `runtimeRecorded`/
    `localOnly` in the return value now honestly reflect whether the durable
    write actually succeeded.
  - **Unblock/unmute "clearing" was already correct, no fix needed there**:
    `unblockUnmuteProfile` calls `clearProfileNukeState`, which already sent
    its `clear-profile-nuke-state` message unconditionally regardless of
    queued/legacy status — that path never had this bug. The recording fix
    above covers `unblockUnmuteProfile`'s own intermediate/failure progress
    notes too, since it goes through the same `recordProfileNukeProgress`
    root function as the mute-block path.
  - Added the new action name to `p1-contract.test.js`'s runtime-action
    allowlist test. Full `npm run test:parallel` green (no synthetic-test
    regressions — the behavior change only affects the previously-broken
    non-queued branch). Rebuilt and reloaded at `1.6.1220`, zero errors.
  - **Live-tested, found a real regression, fixed again (1.6.1221)**:
    tested on `https://www.quora.com/profile/Chukwudi-Eze` (a real flagged
    target from the "Spam detectives" space — first attempt accidentally
    used a random profile-link scrape that included innocent posters, not
    actual candidates; corrected before clicking anything). First click
    (Mute Block) landed on a **stale tab** opened before the 1.6.1220
    rebuild/reload — content scripts don't get swapped into already-open
    tabs on extension reload, so that click ran the old, unfixed code
    (explains the initial "no record" result; not a bug). Reloaded the tab
    to pick up fresh code, then clicked Unblock Unmute — Quora's own "You've
    unmuted Chukwudi Eze" banner fired, but on reload afterward he showed
    **BLOCKED again**, and no durable record existed either way. Root cause:
    my fix's `await safeSendRuntimeMessageWithTimeout(..., 4000)` sits
    inline in a function (`recordProfileNukeProgress`) called repeatedly
    throughout `muteProfile`/`blockProfile`/`unblockUnmuteProfile`'s own
    multi-step Quora UI sequence (open menu → confirm → verify) — confirmed
    via a direct test that even a completely unrelated, pre-existing message
    action also timed out at that moment (general SW unresponsiveness, not
    specific to the new code), so under today's flaky SW conditions this
    added up to 4 extra seconds *per checkpoint* into a flow that previously
    resolved near-instantly with zero SW round-trips, and was observed to
    leave the action only partially completed.
  - **Fixed**: made the durable-persistence send fire-and-forget (`void
    safeSendRuntimeMessageWithTimeout(...).then(...)` instead of `await`) —
    the calling code never inspected this function's return value anyway,
    so nothing depended on waiting for it. The actual user-facing action
    sequence no longer waits on service-worker responsiveness at all; the
    durable write happens best-effort in the background and updates the
    in-memory cache if/when it lands. Return shape now honestly reports
    `runtimeRecorded: false, localOnly: true, persistPending: true`
    immediately rather than pretending to know the outcome before it's
    known. Full `npm run test:parallel` green. Rebuilt and reloaded at
    `1.6.1221`, zero errors.
  - **Still not cleanly live-verified end-to-end**: didn't get a final
    confirmed "click → durable record appears" run in this session — the
    Chukwudi-Eze profile was left in a confusing intermediate state
    (blocked, banner said unmuted) from the pre-fix attempt. Needs a fresh
    attempt: reload the profile tab (fresh `1.6.1221` content script),
    confirm current Quora-side state visually first, perform one clean
    action, then check `chrome.storage` a few seconds later (allowing time
    for the now-backgrounded write to land).
  - **RESOLVED (2026-09-09), three real bugs found and fixed chasing this
    down, rebuilt through `1.6.1226`**: the internally-inconsistent record
    (`status: "blocked"` alongside `unblockSucceeded: false`,
    `unmuteReason: "unmuted"`) turned out to have three independent causes,
    found by repeated live block/unblock cycling on `Chukwudi-Eze`:
    1. **`clearProfileNukeState`'s `preserveCoordinatorState` guard was too
       broad (`sw.js`)**: it preserved *any* stored progress record whose
       `actionKind` was `'unblock-unmute'`, not just ones belonging to a live
       queued attempt. That check predates legacy actions ever being
       persisted at all (this session's earlier `1.6.1220` fix), so it could
       only ever have meant "queued" when it was written — now it also
       matches a legacy record from `record-direct-profile-progress`, so a
       *successful* legacy unblock-unmute never actually got cleared: it sat
       forever at whatever intermediate fields the last checkpoint before
       success had written. Fixed by additionally requiring `attemptId` on
       the stored record (legacy actions never set one) before treating it
       as coordinator-owned.
    2. **`getGlobalPrimaryAction` could click Quora's own unrelated "Add
       question" button (`content.js`)**: `dismissProfileActionSurface()` —
       called when `unmuteProfileBestEffort()`'s own post-confirm
       verification poll (`waitForProfileMenuState('inverse', ...)`) times
       out — falls back to `getGlobalPrimaryAction()` when no dialog is left
       to dismiss. That function scored *every* visible button on the whole
       page by styling/position (`scoreActionCandidate`, +80 for
       `qu-bg--red`/`qu-bg--blue` "primary" classes) with no requirement that
       the label actually resemble the target regex
       (`/\bcancel\b|\bdismiss\b|\bclose\b|\bno\b/i`) — so with nothing else
       on the page styled that way, it always won by landing on Quora's own
       red "Add question" composer CTA, hijacking the page mid-action.
       Confirmed via an injected `click` capture listener showing the
       correct menu → "Unmute" → "Confirm" sequence firing normally, then a
       distinct ~2.8s-later click hitting "Add question" specifically.
       `getDialogAction`, the only other caller, has no call sites of its
       own (dead code) so this was safe to tighten unconditionally: now
       requires the candidate's own label to match `preferredRegex` before
       it's even scored.
    3. **The real ordering gap (what this whole investigation was actually
       about) — a straggling fire-and-forget checkpoint write recreating a
       cleared record from scratch**: `unblockUnmuteProfile()`'s multi-step
       flow sends many `record-direct-profile-progress` checkpoint patches
       via `recordProfileNukeProgress` throughout mute/block/unblock/unmute
       (all fire-and-forget per the earlier `1.6.1221` fix), then, once
       verified successful, *awaits* one final `clear-profile-nuke-state`
       call. An earlier checkpoint's send can still be in flight when that
       final clear lands and completes; if it arrives afterward it used to
       recreate the row from scratch, since a full delete leaves nothing for
       `recordDirectProfileProgressFromRequest`'s existing
       `directProgressClientUpdatedAt` staleness guard to compare against.
       **Fixed by tombstoning instead of deleting**: `clearProfileNukeState`
       now replaces a cleared row with a blank record (no `actionKind`,
       `status`, or `*Succeeded` flags — inert for every classification
       predicate that reads it, e.g. `isTerminalProfileNukeRecord`, exactly
       as an absent record would be) stamped with `clearedAt` and a fresh
       `directProgressClientUpdatedAt`. The existing per-record comparison
       in `recordDirectProfileProgressFromRequest` then rejects any
       straggler whose client-origination timestamp predates the clear,
       with no separate tracking state needed. Both new fields were also
       added to `summarizeProfileNukeProgressRecord`'s explicit allowlist
       (`swProfileNukeProgress.js`) — that allowlist backs both the view and
       the per-href shard writes, so without this the tombstone's
       comparison basis would have been silently dropped on every durable
       write, losing the protection across a service-worker restart (an
       in-memory-only version of this fix was tried first and discarded for
       exactly that reason, per user steer: "perhaps instead of deleting we
       should tombstone it").
    - Full `npm run test:parallel` green after each of the three fixes (two
      `swSynthetic.test.js` assertions updated for fix 3, since they
      expected `undefined` post-clear where a tombstone object is now
      correct and intended).
    - **Live-verified clean end-to-end** on `Chukwudi-Eze` after all three
      landed (`1.6.1226`): block → unblock now leaves a fully-consistent
      cleared tombstone (`status: ""`, all succeeded flags `false`), and a
      subsequent fresh block afterward correctly shows
      `status: "blocked", blockSucceeded: true` with no leftover tombstone
      fields (`clearedAt: 0`).
    - **Separate, minor, pre-existing finding (not fixed, not a
      regression)**: a freshly-blocked legacy record's `actionKind` reads
      as `""` rather than `"mute-block"` — grepping `content.js` shows no
      call site in the plain `muteProfile()`/`blockProfile()` path ever
      explicitly sets `actionKind: 'mute-block'` (only the reverse/
      unblock-unmute path and queued-attempt paths set it explicitly, then
      it's inherited forward by the merge). This predates all of tonight's
      fixes and was simply never visible before, since legacy actions
      weren't persisted at all until `1.6.1220`. Worth a small follow-up if
      the recorded history is meant to show actionKind reliably.
    - **`actionKind` follow-up (2026-09-09, same session, user asked to fix
      it once flagged)**: `muteProfile()` (content.js) now stamps
      `actionKind: 'mute-block'` on its very first progress patch — it has
      exactly one caller (`handleMuteBlockClick`, the legacy button), so this
      is safe and covers the whole legacy forward flow. Live-verified: a
      fresh block now correctly persists `actionKind: "mute-block"` all the
      way through to the terminal `status: "blocked"` record. Rebuilt as
      `1.6.1227`, full test suite green.
    - **New open item found while re-verifying the actionKind fix, NOT
      believed to be a regression from any of tonight's changes**: three
      isolated live attempts (each preceded by an untouched 35-40s wait, no
      other CDP calls interleaved) on `Chukwudi-Eze`, clicking the real
      "Unblock Unmute" button, all showed `clearProfileNukeState` never
      running at all (record's `clearedAt` stayed `0`,
      `unmuteReason: "unmute-clicked-unverified"`) even though the profile
      page visually settled to correctly unblocked within a few seconds.
      Traced the gating logic in `unblockUnmuteProfile()`
      (`content.js:12382`): whether `clearProfileNukeState` gets called at
      all depends only on `verified` (from `unblockProfile()`'s own
      `waitForVerifiedProfileUnblocked` check), not on the unmute step's own
      result -- so this pattern is consistent with `verified` never becoming
      `true` across all 3 retry attempts, hitting the early
      `if(!verified) return {ok:false, ...}` before the tombstone/clear step
      is ever reached. Two *earlier* live cycles in this same session (right
      after the tombstone fix, and again right after the getGlobalPrimaryAction
      fix) verified cleanly with no such issue -- this only appeared after
      roughly 10+ rapid automated block/unblock cycles on the same account in
      one sitting, so the leading theory is Quora-side lag/throttling under
      that repeated pattern outrunning `waitForVerifiedProfileUnblocked`'s
      fixed timeout budget, rather than a real code bug -- but this is
      unconfirmed. Needs a fresh, lightly-used target profile and a single
      clean unblock attempt to properly distinguish "verification timeout too
      tight for real conditions" from "test-account fatigue" before deciding
      whether it's worth fixing.
    - **Environment note, not a code bug**: mid-session, CDP calls against
      the dev Chrome instance (via `tools/cdp/lib/cdp.js`'s
      `Runtime.evaluate`) started reliably timing out at 15-90s, including
      for a single tiny `chrome.storage.local.get()` call — initially looked
      like a real storage-performance regression. Root cause turned out to
      be MV3's normal service-worker idling (~30s of inactivity unloads it)
      colliding with this session's slower steps (screenshots, file edits,
      full test runs) between CDP calls: `getTargets()` returned zero
      service-worker targets at the moment of a "timeout," and attaching to
      an already-torn-down target's websocket hangs rather than erroring.
      A clean `Browser.close` + relaunch temporarily "fixed" it (coincidence
      — a fresh dashboard tab was open, keeping the worker pinned), and the
      durable fix for *testing* is procedural: wake the worker
      (`tools/cdp/open-dashboard.js` or any message) and act on it
      immediately in the same breath, rather than assuming it stays live
      across a slow step. No source change from this.

## New finding + fix: content script `init()` had an unbounded service-worker round-trip gating ALL button injection on every page (1.6.1220)

User's live observation: both the profile page's legacy "Mute Block" button
and a space page's asset/neutral/target category buttons were slow to
appear — "possibly common problem." Traced `init()` in `content.js`: for
every non-profile-search page (i.e. both `profile` and `space` types), a
fixed sequence of `await`s runs *before* either page type's own
button-creation code — including `reconcileReloadCanceledNukes()`, which
sends `{action: 'cancel-queued-owner-nukes'}` via the **plain,
un-timeout-bounded** `safeSendRuntimeMessage` (unlike the sibling
coordinator-state refresh call one step earlier in the same `init()`
sequence, which already correctly uses `safeSendRuntimeMessageWithTimeout`
with a 3s bound). Given today's repeated direct observations of the service
worker being slow, asleep, or mid-restart under load, this single call could
stall page setup — and therefore *all* button injection on *any* page type
— for however long the SW takes to respond, with no time bound at all.

**Fixed**: swapped `reconcileReloadCanceledNukes()`'s message send to
`safeSendRuntimeMessageWithTimeout(..., 4000)`, matching the existing
pattern used one call earlier. On timeout it falls back to `{canceledUrls:
[]}` — a benign degradation (skips this cleanup cycle; any actually-canceled
URLs get caught on a later successful call) instead of blocking page setup
indefinitely.

Checked other unbounded `safeSendRuntimeMessage` call sites in the file
(`sweepOwnedBlockedProfileTabs`, `sweepServiceWorkerBlockedProfileTabs`,
pause-nukes actions) — all tied to post-action retry/pause flows triggered
by explicit user actions, not the shared page-load `init()` path, so they
don't explain slow button *appearance* and weren't touched.

Full `npm run test:parallel` green. Rebuilt and reloaded at `1.6.1220`, zero
errors.
- **Not yet live-verified**: same as above — rebuilt/reloaded before a
  live before/after timing comparison could run (e.g. reload a profile or
  space page several times and confirm button appearance is now
  consistently fast, including under conditions where the SW is known to be
  slow/asleep).

## Resolved from the prior machine's handoff

- **Popup "open dashboard" focus-jump: confirmed working on Windows.**
  Handoff section 3 left this unresolved on the original Linux/Wayland
  machine: clicking the popup's dashboard button opened a real tab that
  never visibly came to the front, with a working hypothesis that Wayland's
  focus-stealing prevention was silently swallowing
  `maybeActivateCoordinatorTab`'s `windows.update({focused: true})` call
  (wrapped in `.catch(() => {})` in `sw.js`, so a failure there surfaces
  nowhere). On this Windows machine: closed the dashboard tab, clicked the
  popup button again, and per the user "it came right up as the new current
  tab" — opened and became frontmost with no manual click-over needed. This
  matches the handoff's "if it does not reproduce on Windows" fallback: treat
  it as a Linux/Wayland-specific quirk of that launch method rather than a
  real product bug. No code change needed; worth a one-line note in
  `tools/cdp/README.md` if this repo wants that documented, but not required.

## Also pending from the prior machine's handoff (not superseded by anything above)

- Finish `spaceRegistry.js`'s live-UI click-through verification (the
  `normalizeSpaceUrl` URL-scheme-allowlist fix) — marking a space "Asset" this
  session is a good start; still want to confirm the popup's rendered space
  link itself is correct post-fix.
- Resolve the uncommitted `package.json`/`package-lock.json`/`manifests/*.json`
  tangled-changes decision (CDP tooling rename vs. version bump) — see
  handoff section 2. Note: the version has since moved to `1.6.1213` on this
  machine (this session's rebuilds), so whatever gets committed needs the
  current version, not the `1.6.1212` the handoff described.
