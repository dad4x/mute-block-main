# Live-testing findings -- 2026-09-14 overnight session

> **Status: HISTORICAL** (24 Oct 2026). Live testing findings (14 Sep, overnight). Open items were not carried forward. Kept as a record. Do not implement from it. planning.md is the front door. Register: [notes register](../docs/notes-register.md).

Context: user clicked "Nuke 'Em" on the "Taking out the Trash" Space with
528 items queued in one batch, then went to bed asking me to keep chasing
(1) a row that appeared stuck/flickering in the dashboard and (2) a
"not so good" handoff time. Both were chased live against the running
1.6.1252 dev build while the batch drained. Findings below; no code was
changed or shipped during this pass -- the extension was left running
untouched per the user's request.

## 1. The "stuck" row (Даниил-Болтенков-1) -- not a backend bug, but a real display-order bug

**What it looked like**: the row sat at/near the top of the dashboard's
queue table, badge flickering between "queued" and (per the user) briefly
"active", never clearing, while other rows behind it in the list kept
completing.

**What was actually true**: the row completed successfully
(`status: "succeeded"`, `outcome: "already-blocked"`) partway through the
investigation. It was never stuck. Confirmed by pulling the *raw* durable
queue (not the dashboard's pared-down view) via
`walSnapshotStore.hydrateSegmentedWalStore` + `recoverProjectedState` run
directly against a live `chrome.storage.local.get(null)` dump -- see
`inspect-queue-sequence.js` pattern in this session's scratchpad, worth
promoting to a real `tools/cdp/` script if this comes up again. That full
item showed `queueSequence: 213`, `activeAt`/`terminalAt` both populated,
`actionSurfaceMode: "worker-window"`.

**Root cause of the confusing display**: two different orderings disagree
and nobody reconciles them:

- The dashboard's queue list (`buildCoordinatorQueueView` in
  [shared/js/swCoordinatorQueueView.js](../shared/js/swCoordinatorQueueView.js):271,
  sort at line ~288 via `getCoordinatorQueueViewSortRank` + time, then
  `localeCompare` on the row key) sorted this row into position #1 (right
  after the one active row).
- The actual execution order the SW's executor uses
  (`queueRuntime.rebuildQueueOrder` in
  [shared/js/swqueueRuntime.js](../shared/js/swqueueRuntime.js):500, sorted by
  `item.queueSequence` ascending) had this row at position 213 out of the
  batch -- genuinely far back in line.

Because all 528 items in one bulk enqueue share the *exact same*
`createdAt`/`queuedAt` millisecond (one synchronous loop, one `Date.now()`),
the view's time-based sort can't tell them apart and falls back to an
effectively arbitrary tiebreak, while the real picker uses the gapless
`queueSequence` counter instead. The result: a row that is 200+ items back
in the real line can render at the very top of the visible queue table,
looking stuck/imminent when it's actually just waiting its normal turn.

**Fix implemented 2026-09-14**: `buildCoordinatorQueueView`'s sort
(shared/js/swCoordinatorQueueView.js:287) now breaks same-rank/same-time
ties by `item.queueSequence` ascending before falling back to the row-key
`localeCompare`. Shipped in 1.6.1253, covered by a new synthetic test
("dashboard queue view orders same-timestamp queued rows by queueSequence,
not alphabetically"), full `npm run test:parallel` green, built and
reloaded live with no runtime errors.

**Correction on the "secondary gap"**: on closer inspection this was NOT a
real flight-recorder instrumentation gap. `transitionCoordinatorItemForQueuedTabLocked`
(shared/js/sw.js) already records an `active-transition` flight event
unconditionally, worker-window surface or not. The full-buffer search that
came up empty was checked at flight-recorder seq ~5297, but this row's real
activation (per its `activeAt`/`terminalAt` timestamps) didn't happen until
after the checkpoint switch at seq ~8441-8444 -- i.e. the search ran before
the row had actually gone active, not after. The extension reload done
later that session (for the queueSequence fix) reset the in-memory flight
recorder before this could be re-verified, so the historical row can't be
re-checked, but there is no code-level evidence of an actual worker-window
instrumentation gap. Retracted; no fix needed here.
recorder events normal per-tab activations get, so this class of "did it
actually run?" question doesn't require a raw WAL read next time.

## 2. Handoff time / secs-per-block -- explained, not a bug

Handoff was 13.8s and secs/block 13.2s early on; later climbed to 24.0s.
Live dashboard `refreshState` at that later point read:

> "Quora slow: throttled to 1 tab, retrying in 5s"

`getEffectiveQueuedTabConcurrency()` in
[shared/js/swQueuedTabActionAuthorityMatching.js](../shared/js/swQueuedTabActionAuthorityMatching.js):175
returns `1` whenever `getQueueLoadThrottle().active` is true, regardless of
any per-item `executorMaxConcurrent`. So the slower handoff/secs-per-block
numbers line up with the existing, intentional Quora-responsiveness
throttle (the same mechanism from earlier this session's "we briefly got
throttled" question) -- not a stuck queue or a concurrency bug. Confirmed
concurrency reaching 4 active tabs simultaneously earlier in the same run
when the throttle was inactive, so the mechanism itself works; it's just
correctly making things slower under real Quora backpressure. No action
item here beyond what's already tracked for throttle visibility.

## 3. Original corruption watch (why this batch was being run) -- clean this time

The 528-item batch crossed the exact same danger zone as the earlier
"missing-segment" incidents: `committedSegments.A` hit the
`COORDINATOR_QUEUE_WAL_SEGMENT_FORCE_SWITCH_AT = 256` hard limit under
active load (soft-switch at 128 kept deferring because of
`runtimeHasWork || durableHasWork`, per
`scheduleCoordinatorQueueWalCheckpointSwitch` in
[shared/js/sw.js](../shared/js/sw.js):6022, until forced through at 256).

This time the checkpoint switch completed cleanly -- confirmed via the new
`queue-wal-checkpoint-switch-start`/`-result` flight recorder events added
earlier this session:

```
start:  reason=segmentSoftSwitch generationId=A committedSegmentsA=256 committedSegmentsB=0
result: reason=checkpointed generationId=B snapshotSeq=2295 checkpointedRecords=658
        committedSegmentsA=256 committedSegmentsB=0 durable=true
```

All 55 of checkpoint B's segments after the switch had matching storage
keys, checkpoint A was fully retired (0 segments), no `missing-segment`
hydrate error, no runtime errors reported by
`chrome.management.getAll`/`getErrors`. So the corruption is NOT
deterministic at this exact trigger point -- it reproduced once out of two
attempts at the same 256-segment forced-switch boundary under load. The new
logging (10x flight recorder capacity + checkpoint-switch events, both
shipped this session) is now in place and will capture the sequence of
events if/when it recurs, without needing a lucky pre-reload snapshot next
time.

## Still-open to-do (unchanged from earlier tonight) -- superseded, see update below

The large-enqueue batching plan (chunking 500+ item enqueues into smaller
sub-batches so a checkpoint-switch threshold crossing can't land mid-batch)
is written up in
queue-wal-segmented-record-followup-2026-05-27.md's
"TODO (2026-09-13)" section -- still not implemented, still the leading
theory for the corruption's root cause even though tonight's repro attempt
came back clean.

## Nothing shipped tonight -- also superseded

No sw.js/coordinator.js changes were made or built during this pass -- the
display-order bug (section 1) has a proposed fix above but was left
unimplemented so the running batch and open Quora tabs wouldn't be
disturbed by a reload while unattended.

## 2026-09-15 update: both of the above shipped later the same overnight session

This doc captured a snapshot midway through a single long overnight session;
everything marked open/unshipped above was implemented, tested, and shipped
before the session ended:

- The display-order bug (section 1) was fixed via the `queueSequence`
  tiebreak in `buildCoordinatorQueueView` -- shipped 1.6.1253.
- The large-enqueue chunking plan was implemented, tested, and shipped --
  see queue-wal-segmented-record-followup-2026-05-27.md's
  "Implemented 2026-09-14" section for the full writeup.
- The corruption class this doc was investigating recurred at least twice
  more after this doc was written, leading to the checkpoint-switch-always-immediate
  architecture change and automatic WAL recovery-from-view -- see that same
  followup doc's "2026-09-15" section, which also captures a still-open
  latent issue (the run registry not surviving recovery) found during
  post-incident auditing.
