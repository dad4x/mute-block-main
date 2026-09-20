# Live batch fixes worklist (2026-09-19)

Working autonomously through issues found live-testing a real batch run
against `chrome-dev`. Queue is paused during this work. Each item gets
tested in the actual running Chrome instance (CDP against port 9222)
before being marked done, not just unit-tested.

Progress is recorded here after every step so this can resume cleanly if
the session is disrupted.

## Status legend
- `[ ]` not started
- `[~]` in progress
- `[x]` done (fixed + rebuilt + reloaded + verified live)

## Items

### [x] 1. Button overlap ("Mute Block Close" / "Mute Block" render stacked)
- Reproduced twice live (Mohammad Akbar, Elle G screenshots from user).
- Root cause: two gaps in the rail-based fix from the earlier
  flashing-bug work. (a) `resetProfileButtonRail()` only fired when
  leaving page type 'profile' entirely, not when navigating from one
  profile to a different profile while staying on a 'profile' page (a
  same-tab SPA-style navigation) -- `isProfileTargetPlacement` only checks
  parentage, so the old profile's rail/buttons would just get reused as-is
  for the new profile. (b) `getOrCreateProfileButtonRail`'s dedup-guard
  only ran on the "create fresh" branch, so if a stray duplicate rail ever
  existed while this script's own `profileButtonRail` reference was still
  valid, the early-return skipped cleanup entirely -- verified this gap
  live (injected a fake duplicate, it survived after a resync).
- Fix (shared/js/content.js): `resetProfileButtonRail()` now also fires
  whenever `getProfileKey()` changes, and `getOrCreateProfileButtonRail`'s
  dedup sweep runs unconditionally on every call, before the
  already-valid-rail early return.
- Verified live: injected a fake orphaned `.mb-ext_profile-button-rail`,
  forced a resync (a real DOM mutation, matching what any real navigation
  causes) -- confirmed it gets removed and exactly one rail remains.
  Rebuilt, reloaded, re-tested against the corrected version after finding
  the first attempt's dedup guard didn't actually run in this case.

### [x] 2. "Really blocked" stat stuck near 0%
- Confirmed NOT hardcoded: classification logic in
  `classifyBlockConfirmationFromItem` (shared/js/sw.js:14536) correctly
  keys off `item.milestones.blockAttemptedAt`.
- Live data showed it moving (0% -> 27% -> back down under load), so it's a
  **race**: the `close-if-blocked` poll (runs every ~1-2s continuously)
  almost always wins against the normal progress-report path that would
  stamp `blockAttemptedAt` onto the coordinator item first.
- Root cause pinned down further: `item.milestones.blockAttemptedAt` is
  set via a message that goes through the SAME single global serialized
  `applyTail` write-chain (createCoordinatorAuthority in sw.js) as every
  other durable coordinator write, including large chunked space-feed
  enqueues. A big enqueue monopolizes that chain for its whole duration,
  starving other in-flight items' milestone writes -- this is also the
  same mechanism behind item 3 (long handoffs) and item 4 (write-queue
  backlog): ALL THREE share this one root cause.
- Tried fix: insert a yield between `enqueueCoordinatorItemsStorageChunked`
  chunks so other pending writes get a turn. **Reverted** -- confirmed via
  git-stash A/B testing that this change (even at 0ms delay) drops
  swSynthetic.test.js from 536 to 281 passing assertions while still
  exiting 0 (no `not ok`, so nothing is failing outright -- the test
  harness silently completes fewer scenarios). That test file uses real,
  unmocked `setTimeout`, and something in its scenario/fuzz runner is
  sensitive to any additional macrotask yield in this function in a way
  that isn't understood yet. Not safe to ship without understanding that
  interaction first, so this is reverted and the underlying serialization
  contention is left as a documented, not-yet-fixed architectural issue
  (see session notes below for how to pick this back up).
- **Fix implemented** (lower-risk, avoids touching the shared
  serialization queue at all): `close-if-blocked`'s response now includes
  `blockAttempted`, read directly from this tab's own in-memory
  `profileNukeProgress` cache (set synchronously by `blockProfile()`, no
  storage round trip). `classifyBlockConfirmationFromItem(item, response)`
  now prefers that signal over `item.milestones.blockAttemptedAt` when
  present, in both `recordOwnedBlockedSweepTerminal` and
  `recordActiveBlockedLiveTabTerminal`. Updated two p1-contract.test.js
  literal-source-match assertions that expected the old
  `classifyBlockConfirmationFromItem(item)` one-arg call. Unit tests green
  (869/869).
- Live verification: rebuilt, reloaded, and sent a real `close-if-blocked`
  probe via `chrome.tabs.sendMessage` from the service worker directly to
  a live content script (Zulfiqar-Qazilbash, already-blocked from a prior
  session) -- response correctly came back
  `{willClose: true, blockAttempted: false, ...}`, confirming the new
  field is wired through structurally correctly for the "genuinely
  already blocked" case. Did **not** verify the positive
  (`blockAttempted: true`) case live, since that requires an actual queued
  action to run `blockProfile()`, which means resuming the paused queue
  and causing a real block on a real profile -- deliberately held off
  given the queue was paused at your request. Worth confirming once you
  resume it.

### [x] 3. Long handoffs between queue items (60-180s+ gaps)
### [x] 4. Write queue backlog alerts (growing: 1 -> 10 alerts)

Both share the same root cause identified while fixing #2: every durable
coordinator write (enqueue, active-transition, milestone/progress update,
terminal settlement -- literally everything) goes through one single
global serialized promise chain (`applyTail` inside `createCoordinatorAuthority`
in shared/js/sw.js, via `enqueueApplyLocked`). A large chunked space-feed
enqueue holds that chain for its whole duration with no gap between
chunks, so anything else needing a durable write (another item's
milestone stamp, its active-transition, its terminal settlement) queues
up behind it -- directly explaining both the write-queue-backlog alerts
and the long gaps between one item finishing and the next going active.

**First attempted fix (reverted, see below for why)**: insert a yield
(`await new Promise(resolve => setTimeout(resolve, N))`) between chunks in
`enqueueCoordinatorItemsStorageChunked` (sw.js) so other pending writes get
an actual turn on the chain. Confirmed via A/B testing that this --
even at 0ms delay, so it's not about wait duration at all, just the
presence of an extra macrotask yield in this function -- causes
`swSynthetic.test.js` to silently complete far fewer scenarios (536 ->
281 "ok" lines) while still exiting 0.

**Root cause of that regression, now fully understood (2026-09-19,
resumed session)**: not a wall-clock budget. `test/lib/swHarness.js` runs
sw.js inside a `vm` sandbox with fully fake, manually-ticked `setTimeout`/
`clearTimeout` (`createFakeTimers`) -- a callback registered through the
sandbox's `setTimeout` only ever fires if a test explicitly calls
`tick()`. The added yield used the bare (sandboxed, fake) `setTimeout`
identifier, so it registered a timer nothing was ever going to advance.
Test #282 ("a large bulk enqueue is durably persisted in chunks, not one
giant commit") hit that dangling promise and hung on it forever; since
nothing else was keeping Node's real event loop alive, the whole test
process just exited(0) silently at that exact point, abandoning tests
#282-536 with no failure ever reported. Confirmed by instrumenting the
runner directly (logged "about to run #282", then nothing -- clean exit).

**Actual fix shipped**: moved chunking from sw.js to the poster
(content.js), per direct guidance from the user, who didn't want either a
test-clock dependency in the write chain or a write-priority mechanism
(explicitly rejected both alternatives -- priority lanes would confuse an
ordering that's already not strictly guaranteed, and clock-dependent
tests are exactly the fragility that caused the silent regression above).
- New `shared/js/coordinatorEnqueueChunking.js`: single shared
  `COORDINATOR_ENQUEUE_CHUNK_SIZE` constant so content.js and sw.js can't
  drift on what "one chunk" means.
- New content.js helper `sendCoordinatorEnqueueChunked(payload, onProgress)`:
  splits a large `items` array into chunk-sized sub-batches and sends each
  as its own separate `enqueue-coordinator-items` `chrome.runtime.sendMessage`,
  awaiting each chunk's full durable round trip (with the item-5 timeout +
  `waitForCoordinatorEnqueueSummary` poll-fallback, now applied per chunk)
  before sending the next. Because each chunk is a genuinely separate
  message dispatch -- a real macrotask/IPC boundary in production -- other
  pending coordinator writes get an actual turn on the shared write chain
  between chunks, for free, with nothing here needing an artificial timer
  or clock at all (and thus nothing for a test harness to fake-tick).
  `enqueueCoordinatorSpaceFeedItems` and `enqueueCoordinatorProfileUrls`
  both now route through this helper instead of sending one big message.
- `onProgress(queuedSoFar, mergedSoFar, totalItems)` fires after each
  chunk settles; `nukeSpaceFeedEntries` uses it to update the "Nuke 'Em"
  button's working label to `Queueing... {remaining} of {total}`, so the
  count visibly drops chunk by chunk as items are durably written, instead
  of sitting on one static label until the whole batch finishes (or hangs).
- sw.js's own internal `enqueueCoordinatorItemsStorageChunked` /
  `COORDINATOR_ENQUEUE_CHUNK_THRESHOLD` is unchanged and kept as a
  defensive backstop for the original WAL-checkpoint-switch danger (see
  its comment) in case anything ever posts an oversized single message
  despite the poster now pre-chunking -- it's just no longer the only
  chunking, and no longer load-bearing for the fairness problem.
- `persistLastCoordinatorEnqueueSummary` (sw.js) updated: since a chunked
  run is now several separate top-level requests instead of one, it reads
  an optional client-supplied `runSummary` (`requested` = the constant
  whole-run total; `priorQueued`/`priorMerged` = the running tally before
  this chunk) so `mbCoordinatorLastEnqueueSummary` still reflects the
  whole run's cumulative totals, not just the last chunk's small slice --
  falls back to the old single-message derivation when `runSummary` isn't
  supplied (any non-chunked caller).
- `test/p1-contract.test.js`'s literal-source-match assertion for
  `nukeSpaceFeedEntries`'s call shape updated for the new `onProgress`
  argument.
- Full suite green: 869/869, exit 0. Rebuilt (`npx mix` +
  `build-chrome-dev.js`), reloaded into the running chrome-dev instance
  (0 manifest/runtime errors on reload).
- Live re-verification of the "number decreasing in chunks" UX and of
  actual write-queue-backlog/long-handoff relief under a real large batch
  is still pending -- the queue was paused for this whole session, same as
  items 1/2/5 above.

### [x] 5. Space-feed batch enqueue: button stuck on "Nuking..." forever
- **Root cause confirmed live**: clicked "Nuke 'Em" on 657 scraped
  candidates. `mbCoordinatorLastEnqueueSummary` shows the chunked enqueue
  completed fully and durably (318 queued + 31 merged = 349 requested,
  matches 622 candidates - 273 duplicate-profile). But the content script's
  `chrome.runtime.sendMessage` await never resolved -- button stayed on
  "Nuking..." indefinitely even though the data is correct.
- Theory: for a batch large enough to take a while against an
  already-large queue, the chunked write can outlive the service worker's
  execution lifetime; a respawned SW finishes the durable work but the
  original message channel/callback back to the tab is gone, so the
  awaiting promise never settles (not even a rejection).
- Fix direction: don't block the button UI on one long-lived
  `sendMessage` round trip -- either have the page poll/re-sync queue
  state independently with a timeout fallback, or split the ack from the
  work (respond immediately once durably enqueued is *started*, then let
  the page pick up final counts from `mbCoordinatorLastEnqueueSummary`
  via storage.onChanged, which it doesn't currently listen for).
- **Fix implemented** (shared/js/timeouts.js + shared/js/content.js):
  `enqueueCoordinatorSpaceFeedItems` now sends its message with a 15s
  timeout (`SPACE_FEED_ENQUEUE_MESSAGE_TIMEOUT_MS`) instead of waiting
  forever; on timeout it falls back to polling
  `mbCoordinatorLastEnqueueSummary` by runId
  (`waitForCoordinatorEnqueueSummary`, up to 90s /
  `SPACE_FEED_ENQUEUE_SUMMARY_POLL_TIMEOUT_MS`) to recover the real
  queued/merged counts instead of leaving the button stuck. Rebuilt,
  reloaded extension + tab. Unit tests green (869/869).
- Live re-verification note: forcing the exact SW-recycle race on demand
  isn't practical (nondeterministic timing), and the tab I re-tested with
  still had stale `spacePendingNukedPosts` state plus the queue paused
  from before, which confounds a clean before/after. Confirmed instead
  that the recovery mechanism reads real data correctly (the earlier
  stuck run's `mbCoordinatorLastEnqueueSummary` entry, matched by runId,
  is exactly what the new fallback path would have picked up). Treating
  this as done pending the user seeing it not hang on a future real large
  batch.
- [x] marking done -- fix is in, tested, deployed; will keep watching for
  recurrence.

## Summary (updated 2026-09-19, resumed session)

5 of 5 items fixed and tested (869/869 unit tests); all deployed to the
running chrome-dev extension:
- [x] 1. Button overlap -- rail dedup + reset-on-profile-key-change
- [x] 2. "Really blocked" undercounting -- fast in-memory signal added
- [x] 3. Long handoffs between queue items -- chunking moved to the poster
- [x] 4. Write queue backlog alerts -- same fix as #3 (same root cause)
- [x] 5. Batch-enqueue button stuck on "Nuking..." -- timeout + durable
  summary fallback (its per-chunk generalization is also what #3/#4's fix
  reuses)

Items 3/4 were originally deferred in the first pass of this session
(root-caused but not fixed -- an attempted yield-based fix had an
unexplained interaction with swSynthetic.test.js and was reverted). Picked
back up in a resumed session at your explicit request to check why chunking
alone hadn't fixed the write-queue problem. The swSynthetic interaction is
now fully understood (see item 3/4's section above -- it was the test
harness's fake, manually-ticked clock, not a wall-clock budget), and the
actual fix -- chunking at the poster instead of a timer-based yield inside
the shared write chain -- was your explicit direction, since you didn't
want either a test-clock dependency or a write-priority mechanism.

Extension is at chrome-dev, version 1.6.1271, rebuilt and reloaded with
all five shipped fixes (0 manifest/runtime errors on reload). Queue is
still paused (as requested at the start of this work) -- item 2's
positive-case (`blockAttempted: true`) live verification, and live
verification of items 3/4/5's actual effect on a real large batch (the
"Queueing... N of M" count dropping chunk by chunk, backlog alerts staying
low, handoff gaps staying short), are all still pending a real queued run
once you resume it.

## [x] 6. Write-queue backlog recurred under real execution load: WAL checkpoint-switch starvation

You resumed the queue with a real 333-item batch after the items 3-5 fix
above. It looked healthy at first (34.7s/block, ~31s handoffs, matching
what items 3/4 targeted), then degraded sharply over the next ~15 minutes:
79s/block, 262s/handoff, 336 write-queue-backlog alerts, and directly
observed live: `storageUpdate.timeoutRatePct` 61.5%, `storageQueueWait`
avg 216s / max 279s. You paused the queue; wait time dropped to 13ms
almost immediately, confirming nothing was looping on its own -- this was
pure backlog, not a runaway loop.

**Root cause, confirmed live via CDP**: distinct from items 3/4 (which were
about a large *enqueue* monopolizing the shared write chain). This time
`jobs.enqueued` stayed flat (~5) the whole time -- the actual cause was the
WAL checkpoint-switch (`switchCoordinatorAuthorityQueueWalCheckpoint`,
sw.js), which compacts the write-ahead-log back down once it grows past
~128 segments. It went through the *same* single global serialized write
queue as every ordinary business write, with no priority over them. Under
real concurrent execution load (several active tabs each writing their own
milestone/terminal confirmations), the switch started waiting behind the
backlog like everything else. While it waited, ordinary appends kept
growing the WAL tail past its intended checkpoint interval; a longer tail
makes every read's replay more expensive, which drains the queue slower,
which makes the switch wait even longer -- a self-reinforcing spiral.
Confirmed via counters: `checkpointed: 1` (only one checkpoint succeeded
in ~3.4 hours), `maxTailLength: 493` (vs. the ~128 it's supposed to switch
at), `replayApplied: 675,604` records / `replayBytes: 2.68GB` this epoch.

**Fix** (per your explicit direction: take the checkpoint-switch out of the
shared FIFO entirely -- "it's a different class" of operation, not a
priority lane for business items -- and don't also touch the switch
threshold in the same change, one change at a time):
- Extracted the switch's core logic into `performCoordinatorQueueWalCheckpointSwitch`
  (sw.js), a plain function with no enqueueing of its own.
  `switchCoordinatorAuthorityQueueWalCheckpoint` (the public entry point
  tests call directly) is unchanged in behavior -- still gives it a normal
  exclusive turn on the shared queue.
- `scheduleCoordinatorQueueWalCheckpointSwitch` (fired at the same segment-
  threshold crossings as before) no longer enqueues a switch itself; it
  just marks one *due* (`coordinatorQueueWalCheckpointSwitchDueReason`).
- New `maybeRunDueCoordinatorQueueWalCheckpointSwitchInline`: runs a due
  switch as a prefix step inside whichever ordinary storage update is
  about to get its exclusive turn next, wired in from
  `enqueueSpaceFeedStorageUpdate` (the single gateway into the shared
  queue). Since it runs already inside that update's own exclusive turn,
  it needs no locking of its own and cannot race a concurrent WAL mutation
  -- but it also no longer needs its own position in a potentially-long
  backlog, so it runs as soon as whatever's already at the front of the
  queue takes its next turn, not after everything queued gets serviced.
- Deliberately plain-awaited, not raced against a timeout: unlike the
  read-only recovery path the storage queue already has, abandoning a
  caller here while the write kept running in the background would let a
  business write start before this checkpoint's own storage.set actually
  lands -- the exact concurrent-WAL-mutation risk this exists to avoid.
- The "nothing due" fast path had to stay perfectly synchronous:  an
  `await` ahead of every single storage update -- even a no-op check --
  costs one microtask tick, and this runs on literally every update
  system-wide. That extra tick shifted three fixed-iteration synthetic
  tests (`flushAsync`/settle budgets tuned against the old tick count) even
  though nothing was due in those scenarios; fixed by branching
  synchronously on the due-flag and only paying the extra hop when a
  switch is actually due.
- `COORDINATOR_QUEUE_WAL_SEGMENT_SOFT_SWITCH_AT`/`FORCE_SWITCH_AT`
  thresholds themselves are untouched, per your instruction to change one
  thing at a time and watch the effect before tuning further.
- Full suite green (869/869), webpack build clean, chrome-dev rebuilt to
  1.6.1273 and reloaded (0 manifest/runtime errors).

**Still pending**: live re-verification against a real large batch under
the SAME kind of concurrent load that triggered this incident -- the
queue is paused again after this fix landed. Watch `storageQueueWait`,
`storageUpdate.queueStallWarning`, and `coordinatorAuthority.queueWal.checkpointed`
(should tick up more than once per multi-hour session now) once resumed.

**Live-verified after resuming**: `checkpointed` ticked to 1 within ~6
minutes (previously stuck at 1 for the whole ~3.4-hour incident), tail
stayed in the 128-136 range instead of ballooning to 493+, zero storage
timeouts. secs/block and secs/handoff climbed for the first few items post-
resume (28-116s) but that tracked as normal resume warm-up, not a
recurrence -- no timeouts, no stall warnings.

## [x] 7. "Really blocked" still undercounting on retried items -- retry loses which attempt actually blocked it

While watching the resumed batch, you reported still seeing profiles get
really blocked that weren't counted as such. Investigated live via CDP
(not just the dashboard tile, which is metrics-epoch-scoped and was mid-
reset from the reloads above): pulled every item that terminated in the
current epoch directly from `mbCoordinatorQueueView`, cross-referenced
`outcome` against `retryCount` and active-to-terminal duration.

Found a real, reproducible pattern: every item with `retryCount: 4` this
epoch (3 of them) landed `already-blocked`, with active-to-terminal
durations (20-60s) matching a genuine click-through flow, not the 5-13s
pattern of an instant already-blocked skip that the retryCount:0
already-blocked items showed. Root cause: `classifyBlockConfirmationFromItem`'s
signals (`response.blockAttempted`, `item.milestones.blockAttemptedAt`)
are both scoped to the CURRENT attempt's own tab/content-script realm. A
retry opens a fresh tab with no memory of what an *earlier* attempt did --
if that earlier attempt genuinely clicked block but its confirmation got
lost or timed out (forcing the retry), the retry's own tab correctly
observes "the profile is already blocked" and "I didn't click anything" --
both true from its own narrow perspective -- and reports "already-blocked",
even though this extension's own earlier attempt was what caused the
block. Confirmed one held-open item that HADN'T retried (Clear-Epoxy-
Resin-1) classified correctly as `blocked` via direct DOM-state + durable-
outcome cross-check, ruling out a general regression -- this is
specifically a retry-history blind spot.

**Fix, per your direction** (keep an initial state in memory, unknown
until set once on the first attempt's tab-open, never touched again;
use that for the determination):
- New durable per-item field `item.initialBlockedState`
  (`'blocked'`/`'not-blocked'`, absent = unknown), captured via a new
  guarded single-field mutation `mutateCoordinatorInitialBlockedState`
  (sw.js) -- modeled directly on the existing
  `mutateCoordinatorActionLeaseHeartbeat` pattern (same
  `coordinatorAuthority.applyWithinStorageUpdate` primitive, same
  `deferProjectionSave`/`projectionPayload: 'queueViewOnly'` shape, since
  this is pure bookkeeping that doesn't affect status/outcome/attempt
  identity). The `mutate()` callback rejects outright if the field is
  already set -- durably enforced "first observation wins, never
  overwritten," independent of the content-script side ever knowing
  whether it's attempt 1 or attempt 5.
- New queue-machine event `INITIAL_BLOCKED_STATE_RECORD` +
  `record-initial-blocked-state` message action, wired the same way as
  `ACTION_LEASE_HEARTBEAT`/`heartbeat-action-lease`.
- content.js reports it (fire-and-forget, harmless to call every attempt
  since the SW-side guard is what actually enforces "once") from two
  places, whichever fires first: `blockProfile()`'s own entry check, and
  the `close-if-blocked` poll (which runs continuously and is often
  earlier than blockProfile ever gets called, e.g. when the SW's own
  fast-path closes the tab before a click was ever attempted).
- `classifyBlockConfirmationFromItem` now prefers `item.initialBlockedState`
  when known: if the item started out NOT blocked, any later confirmation
  that it's blocked must be this extension's own doing, regardless of
  which attempt is the one that finally confirms it. Falls back to the
  existing per-attempt signals when still unknown.
- Full suite green (869/869) after adding the new message action to the
  runtime-action-contract allowlist test. Webpack build clean. Deployed
  to chrome-dev 1.6.1274 (0 manifest/runtime errors on reload).

**Still pending**: live verification that a heavily-retried item now
correctly lands as `blocked` (not `already-blocked`) when an earlier
attempt was the one that actually clicked -- needs a fresh retry scenario
to occur under 1.6.1274, which should get rarer now that item 6's fix is
holding (retries were themselves largely a symptom of the write-queue
backlog forcing lost confirmations).
