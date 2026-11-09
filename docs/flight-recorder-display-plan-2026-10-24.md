# Flight recorder display: plan for discussion (24 Oct 2026)

> **Status: ROADMAP** (24 Oct 2026). Plan for the flight recorder display, for discussion. The intent is not settled: decisions D0 to D8 are open, and nothing has been edited. Not scheduled. If features go first, the view and lifecycle items may be parked (owner, 24 Oct: "this entire discussion is very fine tuning"). Check planning.md before acting on it. Register: [notes register](../docs/notes-register.md).

Status: proposal. Nothing is decided, and nothing has been edited. Read section 0 and section 7 with the owner before any code changes. Facts are from the code as read on 24 Oct; line numbers move, so search by name.

**Terms (owner, 24 Oct).** One concept, several names:

- **Mirror:** worker authority that other contexts can read without a message, held as copies in `storage.session`. Progress's copy there is the progress mirror.
- **Session:** the storage area that holds mirrors. It is memory, not disk.
- **Shadow:** the worker's in-memory progress store, which is WAL-shaped and read for counters. In the code today no other context can see it, so as implemented it is not a mirror. Whether it becomes one, or is removed (decided on 25 Oct), is open.

## 0. Intent comes first

The owner's note on the merge: the events and the recorder were being merged, and "it may not have intended anything". The current display is therefore not a specification. It is what the code does after incremental work. The design doc, [events-to-flight-recorder-design.md](../events-to-flight-recorder-design.md), records the merge (what was built in v1.6.1442) and leaves the display choices open for the owner (its B7 and B11).

Before choosing sizes, columns or layout, the owner needs to say which questions the display must answer. Candidates, to pick from or replace:

- **Q1, subject history.** Given one profile or one queue row, what happened to it, in order, and where is it now?
- **Q2, failure chain.** Given one attempt that stopped, failed or was requeued, what led to it?
- **Q3, decision and effect.** What did the worker decide, and what did the page do with the decision?
- **Q4, where time goes.** Is the run busy, waiting or stalled, and which kind of wait (storage, tab, timeout) is it?
- **Q5, frequency.** How often did a kind of event happen during this run, and for which subjects?

Every later choice in this plan follows from the answers. If no question is chosen, the editor should not start.

**Owner's first impression (tentative, 24 Oct).** Not a synthesis of the records. The display should make each event's subject usefully observable, and group events for one thing together. Status quo: the owner cannot tell what an event was about, and cannot group the events for one thing. Of Q1 to Q5, Q1 (subject history) as grouping is what is wanted; Q2 to Q5 are analysis and are not wanted at first. Since then (owner, 24 Oct): the term is "subject"; the row carries time and kind; storage rows carry what was written, the size and the elapsed time, each when available; every event gets a subject (section 7a). Still open: the subject names, the rule for events with more than one id, and whether a plain per-kind label is acceptable (a label, not a conclusion).

## 1. What the owner asked for

1. **Size.** 200 events is not enough. The owner is open to suggestions on how to manage the size.
2. **Diagnosis.** Each event must show enough to tell what it is about. The owner's words: "we want enough information to know what thing is happening about, and we want to be able to sort on that."
3. **Grouping.** If an event is about a target, all events about that target should sort together.
4. **Detail.** Clicking an event should show more about it, and possibly all the related events for its target.
5. **Merge.** Events and recorder entries were being merged; the owner thinks the merge may have failed so far.

## 2. What the card shows today

The card is the "Flight recorder" panel in the screenshot. Dev mode only; collapsed by default.

- **Where.** The panel and its list are in [shared/coordinator.html](../shared/coordinator.html). The logic is in [shared/js/coordinator.js](../shared/js/coordinator.js), in the functions that refresh, sort, and draw the card. Row styles are in [shared/css/coordinator.css](../shared/css/coordinator.css).
- **Polling.** While the card is open in dev mode, it asks the worker every second for entries newer than the last one it showed. It keeps at most 200 rows (`FLIGHT_RECORDER_CARD_ROW_LIMIT`, `FLIGHT_RECORDER_CARD_POLL_MS` in [shared/js/tunables.js](../shared/js/tunables.js)).
- **Count label.** "200 events" is the number of rows held. It is a cap, not the number retained. The recorder holds 20,000.
- **Columns.** Time, Seq, Kind, Target, Status / outcome, Source / reason, Message.
- **Target.** Taken from the first of three fields that is set: the target URL, the row key, or the source page URL. The label shows the profile slug for profile URLs. For storage and content events none of the three is set, so the column shows a dash.
- **Status / outcome.** Status is set by only a few kinds; outcome by a few more. Most rows show a bare slash.
- **Source / reason.** Filled for most events, but the columns truncate them.
- **Message.** Set for coordinator events and a few others. The census found no recording call site that sets it directly, so most rows are blank.
- **Sorting.** Only Time and Target can be sorted, and only the 200 rows held are sorted. Target-sorting cannot bring in older events for the same target.
- **Clicking.** Rows have no click handler. There is no detail view.

## 3. What the recorder holds today

- **Where.** The recorder module is [shared/js/swflightRecorder.js](../shared/js/swflightRecorder.js). It is read-only with respect to storage: it must never write `chrome.storage.local` (its header says so).
- **Capacity.** A memory ring of 20,000 entries (`FLIGHT_RECORDER_CAPACITY`). A session copy of the newest 2,000 is written at most every ten seconds (`FLIGHT_RECORDER_SESSION_SNAPSHOT_LIMIT`, `FLIGHT_RECORDER_SESSION_PERSIST_MIN_MS`) and restored after a worker restart. So after a restart, only the newest 2,000 entries come back.
- **Entry shape.** `at` (time), `seq` (sequence), `kind`, then every other field the producer gave. Text is capped at 240 characters; URLs at 500; nested objects are saved as JSON capped at 240 characters.
- **Requests.** The worker answers `get-flight-recorder` with `limit` (default 100, maximum 20,000), `sinceSeq`, and exact-match filters on `kind`, `channel`, `rowKey` and `targetUrl`. It returns the newest `limit` matching entries. The card uses only `limit` and `sinceSeq`. Each request copies every retained entry before it filters, so cost grows with the ring.
- **Producers.** 107 recording call sites were found: 102 pass an object literal (58 kinds, counting one dynamic kind), and 5 pass a variable. Two further producers record through hooks, not through that call: the storage lane's `storage-update` events (in [shared/js/swstorage.js](../shared/js/swstorage.js)), and coordinator events, which are converted by [shared/js/coordinatorEventRecord.js](../shared/js/coordinatorEventRecord.js) and recorded with `channel: 'event'`. The static census is therefore an undercount; a live snapshot is the real census (see Phase 0).
- **Subject coverage (literal call sites).** 64 record a target URL; 65 record a row key; 27 record neither. The 27 are mostly storage-write, checkpoint, pause, dashboard, store-size and similar events. `storage-update` events carry no subject either.

## 4. The merge: what is built and what is open

Built, per the design doc's section 0 (v1.6.1442):

- Coordinator events are recorded into the recorder on the event channel. Their kind is the event type; their details are flattened into fields.
- The stored events list is no longer written or read.
- The dashboard's Events list reads from the recorder with `channel: 'event'`, at most 500 rows.
- Clear Events empties the whole recorder. The control sends `clear-coordinator-events`, which calls the recorder's clear. The card's history is therefore cleared too.

Open, and not decided in the doc:

- **B7, the read path.** Keep the existing `get-flight-recorder` action, or add a new worker message.
- **B11, what the list shows after a worker restart.** Every persisted entry (up to 2,000), a cap of 500, or a cap by age. The doc says the age value is the owner's call.

Observed behaviour (from the code; to be confirmed live in Phase 0):

- The Events list reloads through the full dashboard state load. That load runs on dashboard open, on most actions, and every two seconds from the compact refresh, but only while the queue is not definitely idle. So the list refreshes on that cadence while the queue is busy, and otherwise only on open or on an action.
- The card and the Events list both show event-channel entries, with different caps (200 and 500). The card has no channel filter, so it shows everything; the Events list shows only the event channel.
- The Events list's shape is an old one (a message, a type and details). The card's shape is the recorder's own.

Two things the owner should know about the merge:

- Keeping events in a separate stored list would bring back disk writes. The recorder's rules rule that out, so "revert to separate stores" is not a neutral option; it needs its own decision.
- Because there is one ring, any choice about Clear Events affects the card as well.

## 5. Problems, against the owner's goals

| Goal | Problem today |
| --- | --- |
| Size | 200 rows, a cap rather than a total. The ring holds 20,000, and nothing can page to older rows. |
| Diagnosis | Target is blank for storage and content events; Message is blank for most kinds; Status is mostly blank; Source and reason are truncated. |
| Grouping by target | Target-sort covers only the 200 rows held. Events for one target that are older than that do not appear. |
| Detail and related events | No detail view. No query by target from the page, although the worker already filters on target URL and row key. |
| One display, not two | The card and the Events list overlap, use different caps and shapes, and refresh on different triggers. |
| Staleness | The Events list refreshes only while the queue is busy. |
| Cost | Every request copies the whole ring. The card asks every second while open; the Events list asks for 500 every two seconds while busy. Measure before deciding. |

## 6. Options

### 6.1 Size (Problem: 200 is not enough)

- **A. Raise the card's cap and add "load older".** Simple. The page holds more rows, so the browser cost grows, and the worker still copies the whole ring each time.
- **B. Query the worker for what is needed, with paging.** The page asks for a kind, a subject, a time range, or a page of older rows, and the worker returns only that. Needs a cursor (for example `beforeSeq`) and, if the measurement says a scan is too slow, a bounded per-subject index in the worker. This is the option that scales to the 20,000 retained. Filtering before the copy may be enough without the index; Phase 0 decides.
- **C. Time window with a row cap.** Last 5, 15 or 60 minutes, each with a cap. Easy to explain. Hides older events unless the window is widened.
- **D. Persist more.** Raise the 2,000-entry session copy. This changes what survives a restart and uses session storage; the 25 Oct review puts session use near its 10 MiB limit, so this needs a decision on its own.
- **E. Summaries.** Counts by kind and subject over a window, with detail on demand. Answers Q4 and Q5 better than a list.

Owner, 24 Oct: fixed 200 is hopeless. A bigger fixed number keeps the same gap: sorting and grouping see only the rows held, so a target's older events never join its group. Each request copies all retained entries before it filters, so the cost is the same whatever number is shown. Not yet known: how many events a busy run produces (Phase 0 measures it).

For discussion: B for the list, E for the overview, C as a time filter rather than a cap, D only if the owner wants history across restarts.

### 6.2 Subject model (Problem: events are not about anything in particular)

Each event needs a typed subject, so that grouping and related-event lookup work across kinds. Candidate subject types: profile (the target URL), queue row (the row key), attempt (attempt id), run (run id), tab, storage key, checkpoint generation.

- Profile is the most useful grouping key for the owner's goal ("all things about that target"); row and attempt sit under it.
- Coverage among the 102 literal call sites (static census, section 3): profile (target URL) 64; queue row 65; attempt 62; run 46; tab 43; storage label or path 2. 77 sites carry at least one of these; 25 carry none. Only two kinds carry a queue row without a profile URL (fill-decision and terminal-write-outcome), so for queue events the profile and the row mostly coincide.
- Each kind that lacks a subject needs either a subject field at its call site or a stated reason it has none.
- The subject fields should be normalised once (in the recorder or at the call sites), not parsed from text in the page.

### 6.3 Views (Problem: no grouping, no detail)

- **V1. Flat list, sortable on any column,** with filters for kind, channel and subject. Closest to today's card.
- **V2. Grouped by subject.** One row per subject with its count, first and last time, and latest outcome. Expanding shows its events in order. This is the "sort together" view the owner described.
- **V3. Detail on click.** A side panel with every recorded field (noting that text was capped at 240 characters when recorded), and the subject's related events, loaded on demand from the worker.
- **V4. Noise control.** The screenshot is dominated by storage-update and content-request rows. Hiding or folding noisy kinds by default is a display choice; it must not change what is recorded.

### 6.4 The merge (Problem: two overlapping displays)

- **M1. Finish the merge as one stream.** One card with a channel column and a preset filter named for the events. The separate Events list goes, and its contract tests are updated.
- **M2. Keep two roles.** The Events list shows coordinator decisions only (event channel), with a refresh that does not depend on the queue being busy. The card shows everything. Needs clear labels so the overlap reads as intentional.
- **M3. Revert to separate stored events.** Not neutral: it brings back disk writes that the recorder rules forbid. Needs its own decision.

## 7. Decisions needed (in this order)

1. **D0. Intent.** Tentatively (owner, first impression): observable and groupable, not synthesis; Q1 as grouping. To confirm, and to say which groupings matter first.
2. **D1. Size.** Which of A–E, or a combination; whether the 2,000-entry persisted copy changes. Questions to answer first: (a) on a busy run, how far back do the 200 rows reach; (b) should a target's detail show every retained event, or only a recent window; (c) must events survive a worker restart; (d) is 20,000 retained enough for one busy run (depends on the rate, so Phase 0 first).
3. **D2. Subject model.** Which subject types, and which one groups events by default. Partly answered on 24 Oct (section 7a); names and the grouping rule still open.
4. **D3. Views.** Flat sortable, grouped, or both; which is the default. Owner, 24 Oct (leaning): time order with filters, no grouping for now (section 7b).
5. **D4. Detail.** Side panel or inline; how many related events load on click.
6. **D5. Merge.** M1, M2, or another option; and how B7 and B11 from the design doc are settled.
7. **D6. Clear Events.** Clear the whole recorder (today), or only the event channel.
8. **D7. Noise.** Which kinds are hidden by default.
9. **D8. Labels.** One-line summaries built by the worker when an event is recorded, or mapped by the page.

## 7a. Owner decisions (24 Oct, tentative until confirmed)

- **Term.** "Subject", not "thing".
- **Row.** Time and kind, which is enough for a timeline. Everything else is on click (section 6.3, V3).
- **Storage.** A storage row shows what was written (the storage path, and the keys when recorded), its size in bytes, and its elapsed time, each when available.
- **Every event has a subject.** Events that have none today get one, so every event can be grouped.

Proposed rule for events with more than one id (not yet confirmed): one primary subject per event, chosen in this order: profile (target URL); queue row; run; tab; storage path; checkpoint generation; otherwise a global subject (queue, worker, dashboard, storage, run log). The other ids stay as fields.

Subject map for the kinds with no target URL and no row key (21 literal kinds, from the census), plus the storage lane's hook event:

| Kind | Recorded in | Ids it has today | Proposed subject | Change needed |
| --- | --- | --- | --- | --- |
| storage-write | sw.js | storage path, keys, bytes, elapsed time | store label(s) from the areas in the write (see "Storage labels") | add the labels; show path, size and elapsed on the row |
| storage-update (lane hook) | swstorage.js | reason, update token, timings; no path | storage lane, or the path if the writer passes it | decide whether the writer passes the path |
| store-size | sw.js | none | storage (global) | none |
| legacy-content-index-cleanup | sw.js | none | storage (legacy keys) | none |
| queue-wal-checkpoint-switch-start, -result | sw.js | generation id | checkpoint generation | none |
| content-request | swBootstrap.js | action name only | requesting tab | pass the sender's tab id in; the sender is in scope at the call sites |
| tab-removed | swBootstrap.js | tab id | tab | none |
| queued-tab-content-ensure | sw.js | none | the queued row and its tab | the caller passes the row key and tab id |
| compact-view-materialized | sw.js | none | queue view (global) | none |
| dashboard-refresh | sw.js | none | dashboard (global) | none |
| pause-requested, pause-effective | sw.js | none | queue (global) | none |
| start-resume | sw.js | none | queue (global) | none |
| queue-drained | sw.js | none | queue (global) | none |
| fill-recovery | sw.js | none | queue (global) | none |
| running-set-mismatch | sw.js | none | queue (global) | none |
| pending-shadow-mismatch | sw.js | none | queue, or the row when a mismatch names one | check the call site |
| runs-gap-check, runs-disk-gap | sw.js | run count | run log (global) | none |
| debug-resume-limit-set, -reached | sw.js | none | debug run limit, or the run if its id is in scope | check the call sites |

Open for the owner: the subject names in the table, the rule above, whether the storage lane gets the path from the writer, and whether the row keeps the kind.

### Storage labels (owner, 24 Oct)

The owner wants a storage entry to say one of six labels: QUEUE WAL, QUEUE CKPT, RUN WAL, RUN CKPT, HISTORY WAL, HISTORY CKPT.

Facts (checked on 24 Oct):

- **Three stores, one WAL.** The queue, runs and history are three logical stores. Physically there is one WAL and one checkpoint. Each WAL record carries an area: `queue` (QUEUE), `runs` (RUN) and `completed` (HISTORY, the completed rows).
- **WAL writes can mix areas.** A write batch can carry records from several areas: run records are appended in the same batch as queue records.
- **Checkpoints hold every area.** The checkpoint shards keep the map and value areas together, so one checkpoint covers all three stores.
- **Progress is not a store and not a label.** Owner, 24 Oct: progress should not exist anymore; it should never touch disk; it goes through the worker for distribution, not persistence. Checked on 24 Oct: the shadow is memory only (fed from the row events); the disk WAL writer refuses progress-area records; local storage holds no progress key, except legacy keys that the one-time cleanup removes (a delete, once per browser session). The progress mirror is the copy in `storage.session` (writeProfileNukeProgressSession). Distribution already goes through the worker: tools ask with get-profile-nuke-progress, and the worker pushes profile-nuke-progress-changed to tabs that asked. Owner, 24 Oct: storage.session is memory, not disk; a write is a memory copy. So progress may stay there as the worker's distribution copy. Decided (owner, 24 Oct): the one-time legacy sweep stays, as part of storage cleanup on upgrade (it reads 131 legacy names once per browser session and removes only those present). Still open: whether the shadow is removed (decided on 25 Oct); and the session quota (10 MiB), which is a memory limit that still applies.

Proposal (for discussion):

- **WAL writes:** the label list is the set of areas in that write's records, for example QUEUE WAL with RUN WAL.
- **Checkpoint writes:** the event lists QUEUE CKPT, RUN CKPT and HISTORY CKPT, because one checkpoint covers all three.
- **Storage-update lane events:** take the labels from the writer, as they would take the path (the subject map above).
- **Separate checkpoints per store** would make the CKPT labels separate. That needs the three-instance layout in the 25 Oct completed-log plan, which is a storage change and not part of the in-flight work.

### Progress transport (owner, 24 Oct)

- **Progress reaches other contexts by message.** A mirror in `storage.session` would help only the contexts that can read it. Content scripts cannot read `storage.session` on Firefox (the design probes note, lines 80 and 90). On Chrome they would need `setAccessLevel`, which decision 9 rejected for the queue bar. Decision 33 already sends content progress by message, with the worker pushing changes.
- **Extension pages can read `storage.session`.** The dashboard and the tools could read a progress mirror without a message. That is the only place a mirror would help.
- **Size.** The owner says progress is small, so a mirror would fit. The last figure on record says otherwise: progress is about 5.35 MiB of session storage on the dev data (dev dump, 18 Oct), beside about 3.2 MiB for the queue copy, about 9.25 MiB in total, against a 10 MiB limit. Measure on a live profile before concluding that it fits (Phase 0).

## 7b. Owner direction (24 Oct): time order and filters

- Owner: "Maybe we don't need grouping if we get what we really want from the outliers. So maybe time order alone, plus perhaps filtering would be good enough."
- If accepted, the card is a time-ordered list, newest first, with filters. The grouped view in section 6.3 (V2) is not built for now. The per-target view comes from the outlier detail (the outlier plan, section 4), which holds a profile's events for each outlier.
- Filters: the worker's request already takes exact-match filters on kind, channel, row key and target URL. The card does not pass them yet. A tab-id filter would need adding, if the working tab is to be followed (the outlier plan, section 5, question 3).
- A count label, such as "showing N of M matching", with the retention window stated (about eight minutes at the live rate).
- Defaults: the noisiest kinds (storage updates, content requests) hidden by default (D7). Nothing recorded changes.
- Size (D1): the newest N matching events. A filter to one profile or row keeps a fixed number adequate, and paging back is not needed for filtered views while the recorder holds about eight minutes.
- Merge (D5): one stream, with a channel filter, could replace the separate Events list. Still a decision.
- Settled (owner, 24 Oct): a per-target view without opening an outlier is wanted. The profile filter on the time-ordered list gives it, so grouping is not needed. The tab-id filter waits until the view is built. What to do with the events is still open; the owner asked not to discuss them for now.
- Tab events (owner, 24 Oct): no tab subject. Each tab is bound to a profile, so tab events are kept under the profile. Tab-only events, such as tab removal, should carry the profile where it is known; today tab removal carries only the tab id.
- Worker lifecycle (owner, 24 Oct: "we should have flight recorder events for service worker start and shutdown"). A start event records the time and the reason (install, update, reload, or an ordinary wake). Chrome can stop a service worker at any time and gives no shutdown hook, so a stop by Chrome shows as a gap: the last saved entry before the next start marks when activity stopped, and the saved session copy is written at most every 10 seconds. A controlled stop, such as erase or reload, can record its own event. Heartbeat: kept as an open question (owner, 24 Oct). Context: a timer in the service worker did not survive a restart in the 21 Oct probe, while a dedicated Worker on a hidden extension page kept a 1 s timer for 35 minutes ([experiments findings](../experiments/findings-2026-10-21.md), section 1). The write-door move to a dedicated Worker (decided 20 Oct, unmerged, Firefox untested; same findings, section 9) would change where the recorder and resident state live, and so what a stop looks like.

## 8. Proposed phases (after the decisions)

- **Phase 0. Measure, no code.** On a live profile during a busy run: events per minute; the size and time of a 200-row and a 500-row reply; a census of kinds and subject fields from a live snapshot; whether the Events list refreshes while busy and stops when idle; the cost of the whole-ring copy per request.
- **Phase 1. Worker.** Subject fields normalised; a bounded per-subject index; paged queries (`beforeSeq`, `limit`, filters); a request that does not copy the whole ring. Tests in the recorder's unit tests and in the existing recorder-related tests.
- **Phase 2. Card.** Columns per D3; sorting per D3; grouping per D3; paging; a count label that reads "showing N of M retained, K matching".
- **Phase 3. Detail.** Click opens the detail view with related events for the subject, loaded from the worker.
- **Phase 4. Merge completion.** The Events list as decided under D5, removed or repointed; the contract tests updated (section 9).
- **Phase 5. Live check.** After a build, with the owner's go and a version bump in the four files first (AGENTS.md).

## 9. Constraints and risks for the editor

- **Files.** Worker: [shared/js/swflightRecorder.js](../shared/js/swflightRecorder.js), the recorder wiring in [shared/js/sw.js](../shared/js/sw.js), the storage hook in [shared/js/swstorage.js](../shared/js/swstorage.js), the request handler in [shared/js/swBootstrap.js](../shared/js/swBootstrap.js), and the event conversion in [shared/js/coordinatorEventRecord.js](../shared/js/coordinatorEventRecord.js). Dashboard: [shared/js/coordinator.js](../shared/js/coordinator.js), [shared/coordinator.html](../shared/coordinator.html), [shared/css/coordinator.css](../shared/css/coordinator.css), [shared/js/tunables.js](../shared/js/tunables.js).
- **Uncommitted now.** `coordinator.js`, `tunables.js` and `sw.js` have uncommitted changes from another session (checked on 24 Oct). Coordinate before editing them.
- **Pinned by tests.** `test/contentSpaceProfileStateGate.test.js` (card markup, poll interval, the refresh function's name, the target hook); `test/p1-contract.test.js` (the Events panel's scroll target, the `get-flight-recorder` request name, and the outlier-related function names); `test/coordinatorEventRecord.test.js` (the event conversion); `test/swStorageMetrics.test.js` (the key family mapping); `test/swSynthetic.test.js` and `test/acceptedReviewChanges.test.js` (recorder events). Any rename or markup change must update these, or the change must keep them passing.
- **Rules.** Source under `shared/` only; no build, version bump or live run without the owner's go. The recorder never writes storage. Persisted limits need a decision (D1). The 240-character caps stay unless the owner changes them, since they bound memory and the session copy.
- **Performance.** Do not make the worker copy the whole ring per request. Any paging change should avoid that copy.
- **Subject instrumentation.** Adding subjects changes the recording call sites in the worker (section 7a). Those files carry uncommitted changes from another session, so coordinate before editing. Each change must keep the recorder's tests passing.
- **Storage change principle (owner, 24 Oct).** Storage changes clear data with ERASE. There is no migration, and users' complaints are accepted. Upgrade cleanup, including the legacy sweep, is part of that. Not decided. Leaning, per the owner (24 Oct): ERASE runs by itself on an upgrade that changes storage, to the surprise of users. Note that ERASE clears settings and spaces as well as the queue and history, so an automatic run would clear those too. Owner, 24 Oct: this may be why the release is 2.0 (not decided; readme.md already names 2.0 as the public target for the completed reset).
- **Honest limits.** The census is static and misses hook-based producers. Counts and rates here are not measured live.

## 10. Where to start

Outlier windowing is a separate open item: see [the outliers plan](outliers-plan-2026-10-24.md), section 5, question 1. It does not change the recorder design.

1. Owner settles D0.
2. Run Phase 0 on a live profile and record the numbers in this file.
3. Settle D1 to D8 with the owner.
4. Only then start Phase 1, and keep each phase's tests passing before the next.
