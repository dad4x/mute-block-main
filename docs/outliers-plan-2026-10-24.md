# Outliers: recording limit and related events (24 Oct 2026)

> **Status: BUILT in the worktree lane (25 Oct 2026), not built to a package.** Section 10 lists what was built and the choices made on the section 5 questions. Earlier, 24 Oct: Plan for the outlier list: a recording limit, and the flight recorder events kept with each kept outlier until it is cleared. Decisions made: the limit (3.5 seconds or more, tentative wording); the average counts all rows (its effect on the spread test is open); the scope of related events (the same target profile, tentative, plus storage and checkpoint writes inside the span); storage (the events persist with their outlier until Clear); the list shows terminal rows only; the records are for diagnostics and root-cause analysis, not audit. Nothing is built or changed in code, and there is no version bump, build or change to the live run. Not scheduled. If features go first, the tuning items (section 5, questions 1 and 2, and the heartbeat) may be parked (owner, 24 Oct); the duration accounting fix (section 8a) is the near-term correctness item. Check [planning.md](../planning.md) before acting on it. Register: [notes register](../docs/notes-register.md).

Facts are from the code as read on 24 Oct. Line numbers move, so search by name.

## 0. Intent (owner, 24 Oct)

The owner's words, as noted, in order:

- "When an outlier is recorded, we should collect with it all the related flight recorder events, and clicking on that outlier should show all of them."
- "We are currently collecting as 'outliers' the first few with times of 1 and 2 seconds, which is pointless."
- "I'd consider an arbitrary limit of no recording unless > 3 seconds." (After "yeah" to a minimum-length option. Replaced by the 3.5-second wording below.)
- "Not concerned about existing ones at all, just for future."
- "Anyway, once we decide to keep one, I want the recorder events."
- "No implementation. We are note taking and plan making."
- "The old rules as well. All the rows count for average. If most are 1.0-1.5s, an occasional 3 isn't a problem. but 3.5 or more starts to smell."
- "For recorder events to capture, I think ones with the same subject, being the target profile."
- "We'll want them to persist with the outlier until cleared. I don't care much about the size or format as they should be rare."
- "Storage events in the interim will be useful, agree. This will likely mean scanning the events."
- "1. disk writes, yes, as they can perturb. 2. I don't think it scales with the row, but it might be a floor in preferences. 3. It's not a candidate for being an outlier until it's terminal, so there should be no subsequent events. 4. Look at the current live run."
- "terminal := being moved to completed"
- "so, kevin costner probably should not have been recorded."
- "we were experimenting with whether the working tab had ever been activated, in the foreground and/or visible. so there are some legit outliers."
- "excellent questions. Possibly somewhere a decaying average could come into play, or an stddev that was based on a window of time. I am tempted to address point 2 above by putting a timeout on a row that means it will finish before its events vanish, one way or another. Point 3, explain which events those would be? Point 4, fair cop, but if they do terminate, we'll get them. This isn't for auditing, but diagnostics and RCA."
- "I think the 1 hour outliers may be accounting errors reflecting queue time vs. execution time somehow." (Owner, 24 Oct. Section 8a checks this.)

## 1. Facts from the code

- A row is flagged when it runs 45 seconds or more (the floor), or when it runs past the average plus 2.5 standard deviations of the finished rows. The second test starts once five finished rows have been counted.
- The second test has no minimum length. Five quick rows have little spread, so the bar sits just above their average, and the next slightly slower row is flagged. Those entries stay until Clear.
- "Terminal" (owner, 24 Oct) is a row being moved to completed. Finished rows are judged in the same write as that move.
- Running rows over the threshold are listed while they run, with the badge "active". They are not stored. The owner's listing rule (section 2) takes them out.
- The baseline is cumulative: every finished row since the last Clear All Stats counts, and nothing leaves it. An extreme row keeps affecting the spread test until that reset. Clear Outliers keeps the baseline.
- The list keeps the newest 50 entries. Clear empties the list and keeps the baseline. Clear All Stats resets both.
- The whole list is written with every archive. The owner accepted that disk write (18 Oct decision).
- A stale-row watchdog recovers an active row after 3 minutes (180000 ms, in the timeouts file). It recovers a row only when no live tab exists for the row's profile. A row whose working tab is still open is never recovered, however long it runs. That would let a long wait with an open tab run unrecovered; whether the two 1 h 14 min rows were real waits is doubtful (section 8a).
- An entry stores its start and finish times, its profile and its attempt. It shows its duration and the reason. The average and spread it was judged against appear as a hover tooltip on the duration. The name links to the profile. There is no detail view, and no recorder events are kept with an outlier.
- The recorder's event request filters on sequence number and on exact-match fields only. It has no time filter, and it copies every retained event before it filters.
- Events that carry the working tab, and what else they carry:
  - "action-visibility": the profile, the tab id, whether the tab is active, and its visibility state. This is the foreground and visibility record.
  - "window-focus-request": the tab id and the window id, and the profile on some sites. The request made when the worker window is created carries neither the profile nor a row.
  - "tab-removed": the tab id only.
  - "tab-action-claim": the tab id, and the profile and row when the claim had them. Some refusals carry the tab id only.
- Constants: a 45000 ms floor, a 2.5 multiplier, five samples before the second test, and 50 entries (the outlier block in the tunables file). The rule is in the outlier module. The panel text is in the dashboard page.
- Tests that pin the rule: the outlier cases in `test/swSynthetic.test.js`, and the outlier page checks in `test/p1-contract.test.js`.

## 2. Decisions

- **Recording limit: 3.5 seconds or more (tentative wording).** Owner, 24 Oct: "If most are 1.0-1.5s, an occasional 3 isn't a problem, but 3.5 or more starts to smell." It applies on top of both old rules: the 45-second floor and the spread test. The floor is above the limit, so in practice the limit changes only the spread test. It applies to recordings made after it is built. Existing entries are not cleaned up. The owner says it does not scale with the row. It may become a floor in Preferences later; no such setting exists today.
- **Average: all rows count** (owner, 24 Oct). How the baseline forgets is open (section 5, question 1).
- **Listing: terminal rows only** (owner, 24 Oct: "fair cop, but if they do terminate, we'll get them"). Running rows are not listed, so the live running view goes. A row timeout (section 5, question 2) would make every row terminate.
- **Purpose: diagnostics and root-cause analysis, not audit** (owner, 24 Oct). The record needs to explain why a row was slow. Completeness can be approximate.
- **Related events** (owner, 24 Oct, tentative). The events whose subject is the same target profile, plus storage and checkpoint writes (disk writes) inside the outlier's time span. The owner's words: "disk writes, yes, as they can perturb." Storage-update settle records, pause events, dashboard events and store-size events are left out by default.
- **Timing: terminal** (owner, 24 Oct). The events are copied when the row is terminal, and no later events are added.
- **Storage: the events persist with their outlier until Clear** (owner, 24 Oct). They are kept in the outlier record, so they survive a restart. They leave with their outlier: when Clear empties the list, and when the outlier drops off the newest-50 list.
- **Reading:** "keep one" means an outlier kept in the list.

## 3. Before the limit can be trusted

- With typical rows at 1.0 to 1.5 seconds and little spread, the spread test alone would list rows from about 2 seconds up. The limit moves the first listed row to 3.5 seconds. The live list in section 8 is consistent with this: the one 1-second row would be excluded.
- The panel tooltip and the outlier test cases describe the current rule and must change with it. A new test should show that a row under the limit is never recorded, that a running row is not listed, and that a row at or over the limit is recorded if it passes the floor or the spread test.

## 4. Recorder events with a kept outlier

**Scope.** Decided with tentative wording (section 2). Facts that bound it:
- Only events whose recording site sets a target profile can match by profile. In the static census, 64 of the 102 recording sites do. In a live sample of 500 events (section 8), 47% carried a profile.
- Storage and checkpoint writes carry no profile, so they are matched by time span only.
- Events keyed only by tab carry no profile: the tab-removed event, the focus request made when the worker window is created, and the claim refusals that have no profile. Adding the tab id as a subject would bring them in (section 5, question 3).
- Profile matching is exact on the profile address. The recorder stores addresses up to 500 characters.
- Open: which storage kinds count beyond the disk writes (section 2).

**Scan.** The scan makes one pass over the retained events, at most 20,000, once per outlier kept. It keeps the events that match the profile, and the storage and checkpoint writes inside the span. The recorder's current event request has no time filter and copies everything first, so the pass needs a worker-side filter, which the flight recorder plan's phase 1 already asks for. While outliers are rare, one pass per kept outlier is cheap. The click view for a running outlier is no longer needed, because running rows are not listed.

**Size.** The owner does not mind the size, since outliers are expected to be rare. No size cap is planned. The whole list is written with every archive, so events add to each write. That cost is small only while outliers stay rare.

**Where they are kept.** Decided (owner, 24 Oct): inside the outlier record, persisting until Clear. The alternatives were one stored copy per outlier and memory only (events lost on a worker restart).

**Copy and timing.** Events are copied once, when the row is terminal, by the scan above. No later events are added. A long row loses its early events before it terminates unless a timeout ends it sooner (section 5, question 2).

**Click view.** A time-ordered list of the events, where each one opens its full fields. This is the detail view the flight recorder plan describes (its section 6.3 and decision D4).

**Limits.**
- At the live rate (about 40 events a second, measured 24 Oct), the 20,000 retained events cover about eight minutes. The newest 2,000, the session copy that comes back after a restart, cover under a minute.
- Events copied into a kept outlier survive a restart with it. A row that terminates after a restart has only the events the recorder still holds.
- The recorder still never writes storage. The outlier writer copies from it.

## 5. Open questions for the owner

1. **Window the outlier criteria, for the long tail** (open; the owner asked for this to be thought through, and no choice has been made). A few very large rows set the baseline for thousands of rows: a row of a minute or two then cannot be flagged until Clear All Stats. Each finished row counts equally, so a few large durations dominate the mean and the spread. Owner's view (24 Oct): last-N and time windows are out, because each termination would recompute or evict over the window. The statistic should stay incremental, so each finished row costs a constant amount of work. Options that keep that property: (b) decayed sums feeding the mean and spread, so each row's weight halves every half-life, in rows or in time; (d) a decayed histogram on a log scale, which gives the median and percentiles and doubles as the diagnostic distribution (decaying it costs one multiply per bin per row); (g) a streaming quantile estimator with constant memory, if no histogram is wanted (less useful for diagnostics). Two points to weigh. Decay alone does not stop one long row dominating for a while: its effect on the spread is roughly its duration divided by the square root of the effective row count. (e) Cap each duration before it counts, so one long row enters at no more than a set bound; that bounds the spike at once. (f) Keep implausibly long durations out of the baseline; section 8a shows some may be accounting errors. Fix section 8a first, so any window works on true durations. A sliding window could also be kept at constant cost (add the newest value, drop the oldest), but only by storing the last N values, which the decayed sums avoid. Percentile or median thresholds are robust in themselves, but need more samples than the current five before they are stable. Scratch numbers (24 Oct): after one 1 h 14 min row the spread test's threshold was about 8.5 minutes, after two about 12 minutes, and still about 5 minutes after 2,000 more ordinary rows. Which combination, and which values? The threshold rule is also open: keep mean plus 2.5 standard deviations, or use a multiple of the median (the owner's "3.5 s smells against 1.0 to 1.5 s typical" is about 2 to 3 times the median). Then the half-life, in rows or in time, and the cap value. A drift also bears on this: the owner reports the typical time per row going from under 1.0 s to about 2.00 s over a queue of 2,000+ rows (24 Oct). A baseline that follows drift would argue for decay. The cause is to be investigated after the WAL and checkpoint items (planning item 39).
2. **A timeout on a row.** The owner's idea: a row ends at T, so it terminates while its events are still in the recorder. The existing watchdog (3 minutes) skips rows with a live tab, so the timeout must cover those too. At the live rate the recorder holds about eight minutes, and the longest ordinary row in the live list took 31 seconds. About five minutes fits both limits. The outcome at T is undecided: archive as timed out, requeue, or count as a failure. The outcome changes queue behaviour and needs its own tests. Which value and which outcome?
   **Status (owner, 29 Oct 2026): closed for now.** The owner left it closed. No case calls for it, and this question is not answered yes, so Phase 3 is not built (section 6).
3. **The working tab as a subject.** "The working tab" is the queued tab the worker drives for a row; the code calls bringing it forward "promoting" it. The owner asked what this meant, so the definition needs confirming. The profile scope already catches the visibility record ("action-visibility"). Adding the tab id would bring in the few tab-only events listed in section 1: the tab-removed event, the focus request made with the worker window, and the claim refusals without a profile. Settled (owner, 24 Oct): no tab subject. Tab events are bound to a profile, so the profile scope covers them.

Smaller points, decided by default until the owner says otherwise: storage-update settle records, pause, dashboard and store-size events stay out of the span; the 3.5-second value stays a fixed number, not a Preferences setting.

## 6. Phases (status, 29 Oct 2026)

- **Phase 0. Measure (done in part, section 8).** Not finished. Still to do: events per profile for a sample of ordinary rows, and storage events per span.
- **Phase 1. Listing and limit. Built** (section 10: terminal-only listing, the 3.5-second rule). Checked in code 29 Oct: `OUTLIER_MIN_RECORD_MS` is 3500 in `shared/js/tunables.js`, and `shared/js/swCoordinatorOutliers.js` returns no flag under it. The named test cases (under-limit, running-row, at-limit) were not verified in this pass. Not checked live.
- **Phase 2. Event capture. Built** (section 10: recorder events kept with the outlier, and the Events button). The tab-id question is settled (section 5, question 3: no tab subject). Not checked live.
- **Phase 3. Row timeout. Closed for now** (owner, 29 Oct 2026). Left closed; no case calls for it, and section 5, question 2 is not answered yes. Not built. Reopen only on the owner's go.
- **Phase 4. Click view. Not started; parked.** Waits for the owner's live check of the Events button. If the hover text is enough, Phase 4 stays unbuilt.
- **Phase 5. Live check.** Not started. The owner's go.

## 7. Constraints

- No code until the owner says so (owner, 24 Oct).
- Source changes stay under `shared/`.
- Live checks are read-only. The live-check helpers default to an extension ID that is not this build's, so each read needs the ID passed (section 8).
- Uncommitted changes from another session are in the dashboard script, the worker script, the tunables file and the version files. Do not overwrite them (planning.md, loose end 32).

## 8. Live look, 24 Oct (read-only)

- **Build:** "Mute Block Dev", version 1.6.1596, unpacked from the dev output folder, extension ID `kmnnjpcadjhphekdimhpihnaghbbpbhe`. The helpers' default ID is a different one.
- **Dashboard, about 22:15:** running; 2,225 queued; 1 active; 626 completed; 2.06 seconds per block (the dashboard's throughput figure, not a row time); 6 runs.
- **Outlier list:** 7 rows. The list may have been cleared earlier, which is not known.

| Profile | Duration (reason) | Judged against (mean, spread) | Kept under the 3.5 s rule? |
|---|---|---|---|
| HK Seo | 1 h 14 min (both) | 11 s, 3 min 28 s | yes (probably an accounting artifact, section 8a) |
| Kherk Roldan SEO | 1 h 14 min (both) | 2 s, 2 s | yes (probably an accounting artifact, section 8a) |
| Super SEO Tools 1 | 31 s (spread) | 1 s, 2 s | yes |
| Ilya Hinzburh | 26 s (spread) | 1 s, 0 s | yes |
| Erik Sørensen 31 | 17 s (spread) | 1 s, 3 s | yes |
| Stephen Hopkins Seo Expert | 8 s (spread) | 2 s, 2 s | yes |
| Kevin Costner 601 | 1 s (spread) | 0 s, 0 s | no (owner: should not have been recorded) |

- Ordinary rows are judged at means of 0 to 2 seconds. About 1 in 90 completed rows is listed (7 of 626), with the reset caveat above.
- **Spread test after the two long rows** (scratch check against the outlier module, outside the repo): the threshold is about 8.5 minutes after one long row and about 12 minutes after two. After two thousand more ordinary rows it is still about 5 minutes, until Clear All Stats.
- **Recorder sample:** the newest 500 events, spanning 13 seconds (22:17:40 to 22:17:53), about 40 a second. The leading kinds were queued-tab open decisions, content requests, tab open stages, fill decisions, storage writes and storage updates. A target profile was on 47% of the events, a row key on 38%, an attempt on 36%, and a run on 25%.
- **Storage writes in that sample:** 35 in 13 seconds (about 2.7 a second), about 100 KB in total, a mean of 44 ms each.
- **Long rows:** the recorder no longer holds the events for the two 1 h 14 min rows, nor for the 31-second row.

## 8a. Duration accounting (24 Oct)

- Owner, 24 Oct: "I think the 1 hour outliers may be accounting errors reflecting queue time vs. execution time somehow." "I think the run hadn't been running for 20 minutes when the outlier was recorded, which is suspicious." "I know the 20 and 30s ones were legit." The 8 to 31 second entries are taken as legitimate.
- A duration is the terminal time minus the activation time. The two 1 h 14 min rows imply an activation at about 8:52 PM Pacific on 24 Oct. The profile-search run's ID carries the page's clock at run creation, 8:52:18 PM. The implied starts match that time within the rounding of the displayed durations.
- If the run only began working about 20 minutes before capture, as the owner says, the 74 minutes is roughly 55 carried from creation plus about 20 of real work.
- **Path A (fixed).** A requeued row kept the start of its earlier activation. Commit 05e9132 fixes this in the reducer paths (the activation rule and the progress mapping back to queued). The dev build on disk, built 22:08, contains the fix.
- **Path C (not fixed, found 24 Oct).** The queued-target resolution sets the start to `item.activeAt || now` and forces the row to active. A start from an earlier activation survives there. The commit changed the reducer rules, not this line. This is the candidate route for a creation-time start to reach a later activation. Not verified for these rows.
- **Path B (not fixed).** The terminal time can be the tab-close time when the event carries it. Not checked.
- **Not verified:** which activation set the 8:52 PM start. The recorder no longer holds these rows' events, and the loaded worker's code cannot be read from outside it.
- **Consequences:** the baseline and the dashboard averages keep pre-fix durations until Clear All Stats. Any long row after the build should be checked for path C first.
- **Checks and decisions (no code yet):** compare the next long row's activation, work and terminal times with its tab-close event. A path C fix (a new start unless the row is already active) needs the owner's go and its own tests. For RCA, store the activation, work-finished, tab-closed and terminal times separately.

## 9. Related

- [Flight recorder display plan](flight-recorder-display-plan-2026-10-24.md): subject model (D2), detail view (D4), the phase 1 worker filter, storage principle (section 9).
- [planning.md](../planning.md): decided items 5 to 8, loose ends 33 to 35.

## 10. Built (25 Oct 2026)

- **Recording limit.** A flagged row is recorded only at 3.5 seconds (OUTLIER_MIN_RECORD_MS in tunables.js). Every finished row still counts toward the baseline. Future rows only.
- **Listing.** Only finished rows are listed. Running rows are not judged or served; the dashboard shows the Events count for each listed outlier.
- **Recorder events.** When a row is terminal, the recorder is scanned once, and a row at the recording limit or more keeps: the events of its target profile (any time, exact normalized address), and the storage-write and queue checkpoint switch events inside its span. The events are stored inside the outlier entry in mbCoordinatorOutliers, so they persist until Clear or until the entry leaves the newest-50 list. No new storage key.
- **Dashboard.** Each listed outlier has an Events button. The first expand reads the events from the worker (get-coordinator-outlier-events), and the page keeps them until Clear. Each event is drawn as a flight recorder row, with its fields as hover text.
- **Section 5 choices.** (1) Baseline window: not built; the baseline stays cumulative, the simplest option, until the owner picks a decayed or capped statistic. (2) Row timeout: not built (Phase 3 needs a yes). (3) Working-tab subject: none, as settled on 24 Oct; events match by profile only.
- **Not built.** Full field view per event beyond hover text (Phase 4 click view); events are copied only when the row terminates, as the plan says.
