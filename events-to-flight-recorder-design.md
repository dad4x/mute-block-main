# Diagnostic events become memory-only, folded into the flight recorder (section 5B)

Status: built in v1.6.1442 (commit 7068380, tag v1.6.1442). Section 0 records what was built and what differs from this design. Sections 1 to 10 are the 18 Oct design and census; their line numbers are stale and the census no longer describes the code.

Scope: `mbCoordinatorEvents` (`COORDINATOR_EVENTS_KEY`, storageKeys.js:10) and the in-memory diagnostic queue that drains into it. Section 5A (completed work and nuked posts) and 5C (pending records) are separate notes.

Basis: the code on branch `review/shared-wip`. Counts come from a read-only decode of the dev-profile storage dump taken 18 Oct 14:04 (`storage-dump.json` in David's scratchpad), using `shared/js/walSnapshotStore.js` in a scratch script. No profile links or titles were printed. The counts describe one dev profile.

## 0. What was built (v1.6.1442)

- Coordinator events go to the flight recorder, on the event channel. The recorder's buffer is in memory (20,000 entries), and a session copy of the newest 2,000 is kept in session storage.
- The stored events key is no longer written, read, or loaded by any path. The save and reconcile paths no longer carry events.
- The 500 old entries in the stored key were deleted at the owner's request. The key is not written again.
- The dashboard event list reads through the recorder (`get-flight-recorder`, channel `event`), capped at 500 rows.
- Clear Events empties the recorder. The reset does not set a session cutoff.
- The terminal key-only diagnostic (R1) is recorded once per key per worker run, from an in-memory set, not from a durable marker. The run-level R2 gate was removed.
- Pending diagnostics are recorded straight into the recorder. The pending queue is gone.

Differences from the choices in section 7, to check against the owner's record of picks: R1 uses an in-memory once-per-run set rather than the durable marker in B3 (a), which may match B3 (b). The R2 gate was removed (B5 b). Clear Events empties the recorder (B12 a). The old key was deleted after approval (B13 b, executed), not left in place as in B13 (a).

The dev tools that read the old key (`inspect-space-state.js`, `space-summary.js`, `storage-read-profile.js`, `wal-snapshot-benchmark.js`) now rebuild the bucketed maps and no longer read events from storage. The census rows in section 3 describe code that no longer exists.

## 1. Worker reads of events that must move first

Two reads remain in the reconcile pass. The run source-page read (R3) was removed with decision 26 (see the clear history file).

- R1, already-applied check for terminal key-only items. `hasTerminalKeyOnlyCoordinatorEvent` (swCoordinatorReconcileLockedMaterialization.js:358-370) is called from `materializeTerminalKeyOnlyDerivedStateLocked` (372-400, call at 381). That is called from sw.js:11269 for each queue row and sw.js:11525 for the 50 most recent completed rows. The materializer's only write is one event (`eventsChanged`) and the run ID in `affectedRunIds`. It does not change a row.
- R2, queued-derived materializer event gate. `materializeQueuedCoordinatorDerivedStateLocked` (swCoordinatorReconcileLockedMaterialization.js:469-581; called at sw.js:11290) checks `events.some(...)` for a `materialize` event with reason `enqueue-derived-materialization` (gate at 554-558). Its state changes do not depend on that event: the run field fixes (swCoordinatorReconcileLockedMaterialization.js:486-505) and the progress reset (about 531-548) are gated by state (missing fields, missing progress record, stale attempt). The event gate only stops a second event for the same run.

Architecture note: architecture.md:347-348 lists events as a derived materialization, and architecture.md:716-722 says the flight recorder is "not persisted". Both statements conflict with what the code does (R1 and R2 read events as decision input; the recorder writes a session copy, sw.js:5623-5640). The cleanup should correct those lines when this design is approved.

## 2. R1 and R2, already-applied checks

Facts (dump):

- Terminal key-only items: 0 live (any status), 0 completed. `resolve-profile:` rows: 0. So R1 has no items to check today.
- Queued rows: 1,103, across 21 runs. Every queued row has a run record. For all 1,103, the run already lists its profile href, work key and source page, so the run-field gate in R2 does not fire. The progress gate in R2 (missing progress record or stale attempt) was not counted; the progress view was not decoded in this pass.
- `materialize` events: 0. Event types present: `executor-start-superseded` (101), `executor-start-superseded-first-tab` (102), `coordinator-executor-start-promise-reset` (102), `coordinator-executor-start-promise-idle-stale-reset` (1), `stale-attempt` (26).

So, "count of current items lacking the marker": 0 terminal key-only items. For R2, 21 runs with queued rows have no `materialize` event; whether the gate would emit depends on the progress check, which is not counted.

What the first reconcile after a marker change does depends on B3 to B5 below.

## 3. Write and read sites for `mbCoordinatorEvents`

Writes (each one changes the disk key unless marked memory):

Census (grep of `shared/js`, 18 Oct): the rows below cover every writer and every drain of the key, including the enqueue and reconcile read-modify-write paths. `coordinator.js:762` is the dashboard's read default in `loadState` (`storage.local.get` at line 760), not a write. The dashboard writes nothing; it sends `clear-coordinator-events` (`coordinator.js:1260`).

| # | Site | What it writes | Notes |
|---|---|---|---|
| W1 | `flushPendingCoordinatorDiagnosticEvents`, sw.js:5723-5739 (write at 5733) | Drains the in-memory queue, appends, keeps the last 500 | Called from `flushPendingCoordinatorDiagnosticEventsIfIdle` (sw.js:5744-5756). That runs from the storage idle hook (`onIdle`, sw.js:2394-2396) and from the reconcile tail (sw.js:11726). |
| W2 | `saveCoordinatorState`, sw.js:10853-10880 (drain at 10871, payload at 10876-10877) | When `changes.events` is set, drains the in-memory queue into the same write | Any events save also drains. |
| W3 | `applyCoordinatorRunsUpdate` / `coordinatorRunsUpdateLockedUpdate`, sw.js:10944-10990 (events read at 10954 only when appending; save at 10978) | Reads events fresh under the runs lock, appends `options.events`, saves | Callers with events: sw.js:25650 (pause), 25763 (cancel removal), 25896 (item cancel), 26067 (cancel), 26751 (key-only terminalize). |
| W4 | Reconcile save, `persistCoordinatorReconcileAuthorityTransitionPhase`, sw.js:11578 (storage patch at 11668, save at 11673) | `ctx.events` when `ctx.eventsChanged` | Set by R1 (sw.js:11271, 11527), R2 (sw.js:11294; the event is pushed at swCoordinatorReconcileLockedMaterialization.js:573). |
| W5 | Enqueue, `enqueueCoordinatorItemsStorageLocked` (sw.js:24318): read at 24333-24339 from resident state, `enqueued` event at 24623 (with `details.sourcePageUrl`), save at 24713-24716 | Writes the whole array it read | Read-modify-write across awaits (completed-row read at 24349). See B14. |
| W6 | Retry, `mutateCoordinatorFailedItemsRetry` (sw.js:23438): read 23453, push 23566, save 23651-23655 | Whole array | Same pattern. |
| W7 | Requeue, `mutateCoordinatorFailedItemsRequeue` (sw.js:23763): read 23787, push 23930, save 24011 | Whole array | Same pattern. |
| W8 | Clear current work, `mutateCoordinatorStoredWorkClear` (sw.js:26144): read 26223, push 26225, save 26241 | Whole array | Pushes a clear event, then saves. |
| W9 | Resolve unresolved, `markQueuedProfileResolutionUnresolved` (sw.js:32880): read 33014, save 33031-33036 | Whole array, saved with `pendingPosts` in one save | |
| W10 | `applyCoordinatorRowEvent`, sw.js:33136-33139 | Passes `events: [event]` to W3 | |
| W11 | `clearCoordinatorEventsRequested`, sw.js:21675-21680 | Writes `[]` | From the dashboard's Clear Events and Clear All Stats. |
| W12 | `recordCoordinatorDiagnosticEvent` (swCoordinatorJobEnvelope.js:326-349) and `recordStaleAttemptDiagnostic` (sw.js:5758-5772) | Memory only (the in-memory queue) | Drained by W1 and W2. |

Reads:

| # | Site | Use |
|---|---|---|
| Rd1 | Hydrate: defaults sw.js:10581, normalize 10642, projection 10006-10012 | Startup population of the resident authority. |
| Rd2 | Reconcile load: `events: state.events` (sw.js:11199) | Feeds R1 and R2. |
| Rd3 | R1, swCoordinatorReconcileLockedMaterialization.js:358-370 | Already-applied check. |
| Rd4 | R2, swCoordinatorReconcileLockedMaterialization.js:554-558 | Event gate. |
| Rd6 | Enqueue, sw.js:24339 (resident state) | Array to extend and write back (W5). |
| Rd7 | Clear current work, sw.js:26223 | Array to extend and write back (W8). |
| Rd8 | Dashboard `loadState`, coordinator.js:760-762 (read with default) and 804 (parse) | Full array from storage.local on each state load (83 KB raw for 332 events in the dump). Renders at `renderEvents` (2064-2085) and feeds the run submitted time (`getRunSubmitTime`, 2843-2847, used at 1787-1798 and 2044-2047). `getEventDisplay` and `getEventSourceLabel` read `details.sourcePageUrl` (2909-2930). The count line is 1155-1156. |
| Rd9 | Dashboard `clearEvents`, coordinator.js:1259-1262 | Clears local state after W11. |
| Rd10 | Metrics family, swStorageMetrics.js:66 | Maps the key to the `events` family. |
| Rd11 | Retry, `mutateCoordinatorFailedItemsRetry`, sw.js:23453 (resident state) | Array to extend and write back (W6). |
| Rd12 | Requeue, `mutateCoordinatorFailedItemsRequeue`, sw.js:23787 (resident state) | Array to extend and write back (W7). |
| Rd13 | Resolve unresolved, `markQueuedProfileResolutionUnresolved`: default at sw.js:32895, read at 33014 | Array to extend and write back (W9). |
| Rd14 | Dashboard change-key list: `makeCoordinatorDashboardStateKeys` (swdashboard.js:21-31); `COORDINATOR_DASHBOARD_STATE_KEYS` at sw.js:676, passed in at sw.js:2459 | Key list only, no value read. It decides which writes notify open dashboards (comment at sw.js:21744). |

Dashboard run display already takes the run's source page from `sourcePages` (coordinator.js:2904-2907), so the dashboard's source label does not depend on events. Run submitted time falls back to `run.submittedAt` or `run.createdAt` when no event matches (coordinator.js:2843-2847).

Outside readers: Rd8 reads storage.local for queue-namespace state. docs/queue-storage-layering.md section 6 rule 4 forbids that for readers outside the worker, so the dashboard must move to a worker message when the key stops being written.

## 4. The pending queue and worker sleep (what happens today)

- The pending queue fills from W12 and drains through W1 and W2.
- W1 runs only when the queue is idle: no active or queued tab actions, no durable active or queued rows (swCoordinatorJobEnvelope.js:359-368, used at sw.js:5744-5756). The dump has 1,103 queued rows, so during a batch no idle flush runs. Pending events then wait for a W2 drain (any events save) or for the queue to empty.
- W1 is also throttled to one flush per 5 s (timeouts.js:171; sw.js:5750), unless more than 250 events are pending.
- `onSuspend` (sw.js:36048-36052) writes the flight recorder snapshot and flushes metrics. It does not flush the pending queue. So pending diagnostic events are lost at a worker sleep today.
- Durable events (W3-W11) are saved in their own writes and survive a sleep.

## 5. Flight recorder limits the events would inherit

- Ring of 20,000 (tunables.js:10). Session copy of the newest 2,000 (tunables.js:11), written at most every 10 s (tunables.js:12; sw.js:5623-5640) and on `onSuspend` (sw.js:36048-36052). Reseeded at startup (sw.js:36022-36033). `get-flight-recorder` waits for the seed (sw.js:35861).
- Entry shape: `kind` is required (swflightRecorder.js:74-78). Events use `type`, so every event needs `kind` set from it.
- Strings are cut at 240 characters with whitespace collapsed (swflightRecorder.js:30, 37-42). Only `targetUrl` is normalized as a URL (50-57, 59-63). Objects, including `details`, are stored as JSON cut at 240 characters (59-68). So `details.sourcePageUrl` inside a long `details` object is lost, and a long search-page URL in an ordinary field is cut unless it is named `targetUrl`.
- Event messages are up to 500 characters today (swCoordinatorJobEnvelope.js, `slice(0, 500)`), so they are cut to 240 in the recorder.
- Today's event list holds at most 500 (`MAX_COORDINATOR_EVENTS`, sw.js:685). The session copy holds up to 2,000.
- Chrome evidence: the recorder header says its session copy survived "up to 17 restarts in one ~79-minute session" (swflightRecorder.js:14-18). docs/queue-storage-layering.md section 6 still lists Chrome as unverified for `storage.session` surviving an unload. Reconcile the two before relying on it.

## 6. What the dashboard event list shows after a worker sleep

Today: the list shows up to 500 durable events and any pending diagnostics that were drained. A sleep loses the pending diagnostics that were not drained (section 4).

After the move, if the list reads the recorder:

- Worker running: the recorder ring (up to 20,000 entries).
- After an eviction that runs `onSuspend`: the session copy as written at `onSuspend` (newest 2,000).
- After an eviction without `onSuspend`: the session copy as of the last throttled write, at most 10 s before the sleep. Entries from that gap are lost.
- The first request after wake waits for the startup seed (sw.js:35861).
- After a browser restart the session area is expected to be empty (not verified; section 5). The list is then empty until new events arrive.
- Entries older than the newest 2,000 are gone at the sleep, not kept on disk.
- The subtitle that comes from `details.sourcePageUrl` (coordinator.js:2913-2930) is lost unless the field is top-level (B8).

Options for the list's contents:

- B11. (a) Every persisted recorder entry (up to 2,000). (b) Cap at 500 to match today's list. (c) Cap by age (for example the last 24 hours; the value is David's call).

## 7. Choices, with options

- B2. Which page a multi-page run reports: (a) first page (the worker's behavior today, and the dashboard's); (c) most frequent page across the run's items.
- B3. R1 marker: (a) a durable marker on the terminal key-only row, written in the same save as the terminal write (sw.js:26734-26751 and any other key-only writer); (b) no marker: the terminal writer records a diagnostic once, and reconcile stops emitting; (c) keep the event read until cutover.
- B4. R1 rule for rows without a marker at the first reconcile: (a) treat as not applied (one diagnostic per key-only row; the runs recompute it triggers is idempotent); (b) treat as applied (no diagnostic); (c) backfill the marker silently in the first reconcile.
- B5. R2 gate: (a) a per-run marker on the run record, written with the runs change; (b) remove the gate, because R2's state gates already prevent a second derived change; (c) keep the event read until cutover.
- B6. Where R1 and R2 markers live: on the row, on the run record, or both (follows B3 and B5).
- B7. Dashboard read path: (a) the existing `get-flight-recorder` action (read-only, already used by the event histogram at coordinator.js:1607 and 3242); (b) a new worker message that returns a kind-filtered list from the resident ring.
- B8. Field mapping of events into recorder entries: (a) flatten `details` into top-level fields, each capped at 240; (b) keep `details` as JSON (truncated); (c) add named-field caps in tunables for `sourcePageUrl` and `coordinatorKey`.
- B9. Pending diagnostics: (a) record straight into the recorder and drop the pending queue; (b) keep the pending queue and drain it into the recorder on each flush; (c) also drain it in `onSuspend`.
- B10. Session copy cadence: (a) keep the 10 s throttle; (b) write on each event batch; (c) write each recorder write, subject to a rate limit.
- B11. List contents after a sleep. See section 6.
- B12. Clear All Stats and Clear Events (coordinator.js:750-759, 1259-1262): (a) empty the recorder with a new reset action (the recorder has none today; coordinator.js:96-98 says so); (b) a session cutoff like `mbCoordinatorStatsClearedAt` (the existing pattern); (c) keep the durable key only for the clear.
- B13. The old key after cutover: (a) left untouched; (b) deleted after David approves (destructive; not part of this design's writes); (c) kept readable for one release, for rollback.
- B14. Enqueue read-modify-write (sw.js:24333 to 24716): (a) remove the events write from enqueue, since events leave disk; (b) keep it and re-read under the runs-update lock (the pattern at sw.js:10944-10990). The enqueue write runs under a separate lock from `applyCoordinatorRunsUpdate` (sw.js:10934), so an event appended in between can be overwritten. Not confirmed by a test.
- B15. Runs missing on disk (21 IDs, 70 live rows, 2,482 completed rows). (a) Compare resident runs with the disk copy before the cutover, since the source-page and already-applied reads depend on run records. (b) Proceed without the check. The disk copy may be stale for a derived key (architecture.md:392-438).

Count: 14 open choices (B2 to B15).

## 8. Cut-over order (proposed)

1. Read-only check: resident runs against the disk copy (B15a).
2. R1 and R2 (B3-B6). Test that re-reconcile emits no second diagnostic.
3. Dashboard read path (B7). `coordinator.js:804` stops reading the key.
4. Stop the writes: W1-W2 drain (B9), W3-W10 stop carrying events, W5 (B14).
5. Clear and cleanup (B12, B13).

Each step lands with its tests. Writes are removed in one step, not partly.

## 9. Test plan

Existing tests that assert event behavior (to change; the old assertion and the new one):

- swSynthetic.test.js:15974. Old: `reconcileResult.eventsChanged === true` after a key-only derived failure. New: depends on B4 (false if diagnostics are memory only).
- swSynthetic.test.js:16047. Old: the event with reason `synthetic-key-only-derived-failure` is absent from `storage.mbCoordinatorEvents`. New: the same check against the recorder.
- swSynthetic.test.js:16682. Old: `current.events` ids equal `['event-authority-hydrate']`. New: no events in resident state.
- swSynthetic.test.js:22752. Old: `reconcile.eventsChanged === true` after a queued derived materialization. New: depends on B5.
- p1-contract.test.js:1466 and 1688 (the events panel scroll target in the dashboard contract) and 6165, swStorageMetrics.test.js:29 (key family mapping). Keep until the key is removed from the mapping.
- 541 synthetic references to `mbCoordinatorEvents` (mostly `mbCoordinatorEvents: []` in fixtures). Keep the fixtures; they become inert after cutover.

New tests:

- The source-page read uses `sourcePages` and reads no events (spy on the events accessor). Confirm the test exists; the code change is in place (decision 26).
- R1 and R2 with markers: exactly one diagnostic per marked item; a second reconcile emits nothing; no row or run field changes from R1; the missing-marker rule (B4).
- Recorder mapping: `type` becomes `kind`; `details` flattened or capped as B8 chose; a 240-character cap case.
- Sleep behavior (fake timers): the session copy restores the newest 2,000 after a simulated restart; a write in the last 10 s before a hard kill is lost (documented, not hidden).
- Guard: after cutover no storage write carries `mbCoordinatorEvents` (a harness that records every `set` payload).
- Pending queue (B9): drained on `onSuspend` only if B9c was chosen.

Lints: `lint:no-outside-writes` (the dashboard read moves to a message), `lint:queue-storage-layering` (the allowlist only shrinks), `lint:block-classification` if any terminal classification changes.

Wiring: any new test file goes into `npm test` and `tools/run-tests-parallel.js` (repo rule).

## 10. Guardrails the move keeps

From historical/flight-recorder-plan-2026-06-04.md: no authority decisions based on recorder contents; recorder failures must never poison queue authority or WAL acknowledgement. That is why R1 and R2 must read durable fields first. From architecture.md:716-722: the recorder is "not persisted" and "not authority". The session copy already breaks the first statement, so the architecture text needs updating with this design.
