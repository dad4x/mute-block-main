# Mutated Running Total Audit — TODO — 2026-09-25

> **Status: ROADMAP** (24 Oct 2026). Audit to-do for running totals recomputed and written back (25 Sep). Runs have since moved to the log; the audit is not recorded as done. Not scheduled. Check planning.md before acting on it. Register: [notes register](docs/notes-register.md).

## Related but distinct bug, fixed same day: archived-row dedup blind spot

Not a mutated-running-total instance -- a different failure mode from the
same root cause (`archiveTerminalCoordinatorRow` changing an invariant,
"a terminal row stays visible in `mbCoordinatorQueue`," that other code
implicitly depended on). Live repro: a profile mentioned across many
different posts in one large space feed kept getting a fresh tab opened for
it over and over despite already being successfully blocked, and secs/block
climbed as a result. Root cause: `enqueueCoordinatorItemsStorageLocked`'s
`existing = nextQueue[coordinatorKey]` lookup (`shared/js/sw.js`) only ever
checked the live authority queue -- once a row archives out of it, any later
enqueue for the same href/coordinatorKey found nothing and was treated as
brand new. Fixed by loading the full completed-work log once per enqueue
call and falling back to it when the live queue doesn't have the row; a
completed row with no reset reason (already succeeded, not a retryable
failure) is now recognized and left alone instead of reopening a tab, while
a genuinely retryable/reset case still correctly revives the row into the
live queue. Two regression tests added in `test/swSynthetic.test.js` cover
both branches.

**Correction**: the content-queue-index (`buildCoordinatorContentQueueIndex`,
`swCoordinatorContentQueueIndex.js`) was initially flagged as a second
instance of this same gap. On implementation-time inspection that's wrong --
`shouldIncludeCoordinatorItemInContentQueueIndex` has *always* excluded every
terminal item, independent of archiving (it predates archiving entirely).
That index's actual job is "what has live/pending work right now" for
content-script UI (queued badges, avoiding double-submitting something
already in flight), not "was this profile ever fully processed" -- so it was
never meant to catch this case and isn't a second bug. The real "already
done" signal for content scripts is the separate `profileNukeProgress` store,
which archiving doesn't touch at all. No change made there.

## Motivating problem

See architecture.md's "Derived Stats Must Not Be A Mutated Running Total"
section (added this session) for the full writeup. Short version: a field
that looks like a "derived materialization" but is actually maintained as
`next = prior + delta` or `next = recompute(seed-from-existing-value, ...)`,
written back to a durable key by multiple independent, unserialized call
sites, is a lost-update race waiting to happen whenever two of those writers'
read-then-write cycles overlap (which just needs an `await` between the read
and the write — trivially true for anything going through storage).

## Confirmed instances (found, not yet audited further)

1. `mbCoordinatorRuns[runId]`'s `itemCount`/`activeCount`/`terminalCount`/
   `targetProfileHrefs`/`targetWorkKeys`, recomputed via
   `recomputeCoordinatorRuns` (`shared/js/swCoordinatorRuns.js`) from ~24
   independent call sites in `shared/js/sw.js` (enqueue, requeue-failed,
   redirect-mismatch terminalize, non-profile-landing terminalize,
   exhausted-rollback terminalize, and others — `grep -n
   "recomputeCoordinatorRuns(" shared/js/sw.js` lists them all). Live evidence:
   a 13-item run's tracked `itemCount` settled at 4 after several items
   terminalized in quick succession.
2. `mbCoordinatorRuns[runId]`'s `enqueueRequested`/`enqueueQueued`/
   `enqueueMerged`, accumulated as `priorX + delta` read from `runs[runId]` at
   the top of `enqueueCoordinatorItemsStorageLocked` (`shared/js/sw.js`,
   around line 22020). Same key, same race, smaller blast radius (display-only
   counters).

## What's being fixed now (this session)

The *display-facing* numbers only: the dashboard no longer trusts
`mbCoordinatorRuns[runId]`'s mutated `itemCount`/`targetProfileHrefs`/
`targetWorkKeys`/`activeCount`/`terminalCount`/`status` — it requests a
freshly-computed-on-demand runs summary from the service worker instead
(scanning current queue authority + the full completed-work log, not a
mutated running total). See the accompanying code change for specifics.

## Audit pass 2 (2026-09-25, later same day)

Grep-based sweep of `shared/js/*.js` for the same shape (a value read from a
durable key, adjusted by a local delta or recomputed from a stale seed, then
written back, with an `await` between the read and the write and no evidence
of a lock covering that key across all its writers).

### New confirmed violation

3. **`mbCoordinatorEvents`** (the activity-log array shown on the dashboard)
   has the identical structural problem, and it rides along for free with
   every one of the `runs`-mutation call sites already found: every one of
   the ~7 `events.push({...})` sites (`grep -n "events\.push(" shared/js/sw.js`)
   reads its own fresh copy of the whole `events` array near the top of its
   function, pushes one new entry locally, and writes the *entire array* back
   later via the very same `saveCoordinatorState({runs: nextRuns, events})`
   call already used for the runs write (confirmed directly at
   `enqueueCoordinatorItemsStorageLocked` and the failed-retry mutation,
   `shared/js/sw.js` around lines 21185 and 22144-ish). Two of these
   operations racing (e.g. a "retry failed" click landing at the same moment
   as a reconcile-driven terminalize) silently drops whichever one's push
   didn't win the write. Lower stakes than the runs-count bug (a missing
   activity-log line, not a wrong number driving decisions or display
   totals), but same root cause and same fix surface — since it's bundled
   into the identical `saveCoordinatorState({runs, events})` call sites,
   whatever serialization fix gets chosen for `runs` should cover `events`
   for free. Not fixed this session.

### Checked and found safe (documented so this isn't re-litigated later)

- **`incrementQueueWakeupMetric` / `recordQueueWakeupPhase`**
  (`swQueueWakeupMetricsShape.js`) look like the same "read prior, add delta"
  shape but are not a violation: they mutate a *resident in-memory* epoch
  object synchronously (no `await` between the read and the write), then
  schedule a debounced flush to storage separately. Nothing can interleave
  mid-mutation because nothing yields control mid-mutation. This is the
  reference example for what a *safe* running total looks like, if a real
  case ever needs one instead of on-demand computation.
- **Per-row fields on queue items themselves** (`retryCount`, `attempt`,
  `attemptNumber`, etc.) — read-modified-written from inside the same
  `mutate()` callback passed to `coordinatorAuthority.applyWithinStorageUpdate`,
  which already serializes all mutations of that one row. Single row, single
  lock, no gap for another writer of the *same* row to land in between.
- **content.js's local `queued`/`merged` chunk-accumulation loop**
  (`sendCoordinatorEnqueueChunked`, around line 9332) — plain local
  variables incremented inside a sequential `for` loop that `await`s each
  chunk's response before starting the next; there is exactly one writer and
  it never yields to a sibling. Not storage-backed at all until the final
  tally is sent.
- `swProfileProgressMerge.js` — checked for the same shape; found
  `attemptNumber` etc. are always *set from the incoming patch*, never
  read-then-incremented from a stale local seed.
- `spaceRegistry.js` — no accumulator-shaped fields found.

### Still open

- [x] Grep the rest of `shared/js/sw.js` (and its extracted sibling modules)
      for the same shape — done, see above; the two new findings are
      `mbCoordinatorEvents` (confirmed) and nothing else turned up in
      `swProfileProgressMerge.js`/`spaceRegistry.js`/the metrics module.
      Also checked `swProfileNukeProgress.js`, `swCoordinatorProgressReducer.js`,
      and `swCoordinatorProgressRules.js` directly for the same shape
      (`prior`/`existing?.field + `/`Count: ... + `/`+= ` greps) — nothing
      found; progress-record fields are consistently patch/set-from-incoming
      rather than accumulated from a stale local seed.
- [ ] Decide the fate of the ~24 internal `recomputeCoordinatorRuns` call
      sites: keep as a mutated running total but add real serialization
      (a lock/queue shared across all `runs`-touching writers, mirroring
      `coordinatorAuthority`'s existing per-row lock — this would also cover
      `mbCoordinatorEvents` for free, since they're written together), or
      move them to on-demand computation too now that a fresh-computation
      path exists.
- [ ] Fix (or explicitly accept the small risk of) the
      `enqueueRequested`/`enqueueQueued`/`enqueueMerged` accumulator race.
- [ ] Fix (or explicitly accept the small risk of) the `mbCoordinatorEvents`
      lost-append race described above.
- [x] Dedicated pass over `mbProfileNukeProgress`/progress-shard code for the
      same pattern — done, nothing found (see above).
- [ ] Once a serialization approach is chosen for `runs`/`events`, decide
      whether it's a single shared lock (simplest, mirrors
      `coordinatorAuthority`) or something narrower per-key.
