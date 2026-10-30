# Codebase Familiarization Notes — 2026-08-28

> **Status: HISTORICAL** (24 Oct 2026). Orientation notes on queue states (28 Aug). Partly out of date; use architecture.md. Kept as a record. Do not implement from it. planning.md is the front door. Register: [notes register](../docs/notes-register.md).

Session notes from first-time orientation in this repo, triggered by a live
bug hit while driving the extension over CDP against real Quora
("trollsgalore" space, "Nuke 'Em 28" button). Not a canonical doc — a
snapshot from one orientation pass. See `architecture.md` / `planning.md` for
the canonical model.

## Layout

- `shared/js/*.js` is the only real source. `chrome/js/*` and `firefox/js/*`
  are pure webpack/mix build output (byte-identical bundles) — never edit
  those directly.
- Biggest files: `shared/js/sw.js` (38,914 lines, the service-worker queue
  authority monolith), `shared/js/content.js` (13,001 lines, Quora page
  content script), `shared/js/coordinator.js` (2,153 lines, dashboard page).
- Queue-machine/runtime split modules (`swQueueMachineHandlers.js`,
  `swQueueMachineDispatcher.js`, `swQueueMachineEvents.js`, `swqueueRuntime.js`,
  `swscheduler.js`, `swexecutor.js`, `swmessages.js`, `swquoraTabs.js`,
  `swprojections.js`) are small (1584 lines total) and contain almost no
  decision logic — they're a thin, well-encapsulated typed-event
  dispatch/capability-injection layer. The actual queue-authority *policy*
  (reconcile tick phases, claim/adopt/requeue decisions — the fixed-point
  cases architecture.md describes) still lives directly in `sw.js`, not in
  these split-out modules, despite architecture.md's stated direction that it
  should keep moving out.
- `shared/js/swstorage.js` (377 lines) + `shared/js/walSnapshotStore.js` (945
  lines) implement the WAL/checkpoint model; matches architecture.md's
  described shape well (segment/generation/manifest, fails closed on
  missing/mismatched segments).
- Small pure modules (`jobState.js`, `subject.js`, `spaceRegistry.js`,
  `nukedPosts.js`, `sharedModeration.js`) are clean, well-tested-looking, no
  authority violations.
- Tests: `npm test` runs 14 files. `test/swSynthetic.test.js` (34,291 lines)
  and `test/p1-contract.test.js` (4,744 lines) are the two heavyweight
  suites. `p1-contract.test.js` is largely **static text/structure
  assertions** on extracted function bodies (regexes over source text, e.g.
  "does this function call that function") rather than runtime simulation —
  useful for enforcing architectural boundaries mechanically, but it cannot
  catch timing/ordering bugs. `swSynthetic.test.js` uses a fake-timer VM
  harness (`test/lib/swHarness.js`) to simulate `sw.js` scenarios, but
  doesn't drive real `content.js` DOM behavior. This is a plausible reason
  the live loop bug below passed `npm test` cleanly.

## Live bug: space-feed "Nuke 'Em" loop (Martin Harper repeat-dispatch)

Reproduced live this session: clicking "Nuke 'Em 28" on a space feed page
caused the same profile (Martin Harper) to be repeatedly re-opened as a tab
instead of the run advancing through the batch. Progress record stayed
`status: "queued"`, `tabId: null`, `tabCreatedAt: 0` the whole time.

**Root cause (high confidence, sw.js fork):** the code opens the tab as a
provisional side effect *before* the durable claim write — the reverse of
architecture.md's own stated ordering ("durably claim, then open/nudge as
provisional side effect"). `createOwnedTab` (sw.js:29609) opens the tab and
writes only to the runtime-only `swqueueRuntime` cache
(`setPendingTabAction`). The durable transition out of `status: "queued"`
only happens in `transitionCoordinatorItemForQueuedTabLocked` (sw.js:16657),
reached via `claimPendingTabAction` (sw.js:33977) — which only fires when the
**content script in the newly-opened tab** sends `claim-tab-action` back to
the SW. If that message never arrives (slow load, redirect, challenge page,
tab replaced before the script initializes), the durable row is stuck at
`queued` forever, and `runCoordinatorReconcileTickOnce` (sw.js:24063) treats
that as the "queued + no runtime" fixed point and re-opens a tab for it every
tick — the observed loop.

**Second, independent contributing mechanism (storage fork, medium-high
confidence):** `walSnapshotStore.js`'s `shouldApplyPatch` (line 743, guard at
line 736) silently rejects a WAL patch as `stale-attempt` whenever two
different `attemptId`s share the same `attemptNumber`. If a retry/reopen path
in sw.js reuses `attemptNumber` instead of incrementing it, every subsequent
patch for that row gets silently dropped (`{ok: false}`, no counter, no log)
and the projected record freezes at its very first snapshot forever — exactly
reproducing what we saw. Not confirmed against the actual retry code (out of
that fork's scope); worth checking whether space-feed retry/reopen bumps
`attemptNumber`.

**Third, independent contributing mechanism (storage fork, live-relevant):**
`swstorage.js`'s serialized storage-update queue starts each write's timeout
clock at *enqueue* time (line ~262), not when the write actually starts
executing after waiting for the prior write in the FIFO lane. Under a
19-profile burst with near-identical `queuedAt` timestamps, later writes can
burn their whole timeout budget just waiting in line, get marked
`didTimeout`/abandoned, while the actual write still lands afterward in the
background — a caller can treat a write as failed while it's still going to
land, another route to "reconcile sees stale state."

**No dedup guard at the runtime layer (queue-machine fork):**
`swqueueRuntime.js`'s `enqueueActivationIntent`/`requeueActivationIntent`
(lines 355-381) do zero deduplication against existing pending/active
entries for the same profile — the module exposes a predicate helper
(`someActivationIntent`) callers *could* use to guard, but nothing forces it.
This means the runtime layer would not itself stop a caller in `sw.js` from
re-enqueueing an already-in-flight profile; whether `sw.js` actually does
this needs a follow-up read of `planQueuedActivationIntentForSlotEvent`
(sw.js:16428) and `reprimeQueuedTabActionsForNoOpenEvent` (sw.js:16332).

## Live-verified bug: dashboard "Cancel Current Work" silently no-ops during exactly this failure mode

Separate from the loop itself: `coordinator.js`'s `cancelCurrentWork`
(line 858-864) refuses to even send the `cancel-coordinator-current-work`
message unless `getPendingCurrentWorkItems().length > 0`, which reads the
derived `mbCoordinatorQueueView`. **Live during this session**,
`queue-summary.js` showed the run's `total/queued/active/succeeded/failed`
counts all at `0` while `totalProgress` (raw progress records) was 19 and the
run's own `status` was `"active"` — i.e. precisely the state we were in. A
real user clicking "Cancel Current Work" in the dashboard UI during this
incident would have gotten a silent no-op (`reason:
'no-pending-current-work'`), no visible error, while the loop kept running.
This is a concrete, currently-reproducible instance of the exact risk
architecture.md warns about generically (dashboard reads drifting from
authority) — and it disables the user's own kill switch exactly when it's
needed most.

(We personally worked around this by using `pause-coordinator-nukes`
instead, which has no such gate and succeeded.)

## CDP tooling asymmetry: why `cancel-current-work.js` failed but `pause-queue.js` worked

Pure tooling bug, not a product bug (sw.js fork, high confidence).
`pause-queue.js` matches the coordinator page target with
`url.startsWith(dashboardUrl)`, which catches the
`coordinator.html#worker-window` variant that was actually open, and sends
`chrome.runtime.sendMessage` from a real page context. `cancel-current-work.js`
only falls back from an exact `coordinator.html` page match to the raw
`service_worker` CDP target, then tries `typeof cancelCoordinatorCurrentWork
=== 'function'` (always false — that function is a bundle-internal closure,
never assigned to `self`/`globalThis`), and falls through to
`chrome.runtime.sendMessage` sent *from inside the SW's own evaluate
context* — which produces "message port closed before a response was
received" because the SW doesn't hear its own broadcast the way a page does.
Fix: give `cancel-current-work.js` the same `startsWith` page-matching
`pause-queue.js` uses (ideally via a shared helper), and drop the
dead "call the SW global directly" branch.

## Other things worth follow-up (not yet root-caused)

- `content.js`'s `getLiveSpaceFeedEntries`/`getQueueableSpaceFeedEntryUrls`
  filtering wasn't fully traced — unclear whether it excludes URLs that are
  already active/pending at click time, which could be a secondary source of
  duplicate enqueue on a second click.
- Six `repair-reprime`-named diagnostic-reason strings remain in sw.js
  (lines 14095, 14154, 19180, 21653, 33121, 36939) — appear to be flight-recorder
  tags only, not live "repair" code paths, but worth a terminology audit
  against architecture.md's naming rules.
- No metric/counter exists anywhere for WAL patch rejections
  (`stale-attempt`, `terminal-regression`, etc.) or for
  `inactive-generation-append` rejections — this whole class of silently
  dropped authority writes is invisible without ad hoc storage dumps (as we
  did live this session to find the Martin Harper record).
- Two P1 bugs noted in the stray, untracked `review-1.md` (an old review
  finding — `openReservationHref` used-before-declared, and undefined
  `reason` in `mutateCoordinatorActiveWithoutRuntimeActorReconcile`) were
  checked against current `sw.js` and are **already fixed** — not live
  issues, don't re-flag.
