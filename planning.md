# Mute Block Planning

Date: 2026-10-24. Rewritten on this date; it replaces the 15 Oct version. This is the front door for the `main` line. Read this file first, then follow the links for detail. The status of every note is in [docs/notes-register.md](docs/notes-register.md). Dead ends are in [docs/dead-ends.md](docs/dead-ends.md).

The active line is private `1.6` stabilization for the public `2.0` release. The `1.5` notes are design history, not the place to start new work.

## Which source wins

When notes disagree, the higher item wins:

1. The code, its tests, and the git history: what runs, and what was committed. Only the code is evidence of behaviour.
2. [AGENTS.md](AGENTS.md): build, version, test, and live-browser rules.
3. [architecture.md](architecture.md): the current model, constraints, and known tradeoffs.
4. Dated owner decisions, in force until a later decision changes them: [dead-ends-review-2026-10-24.md](dead-ends-review-2026-10-24.md) (decisions 1 to 8, 25 Oct) and [coder-instructions-2026-10-20.md](coder-instructions-2026-10-20.md) section 2 (decisions 2 to 33). A later date wins.
5. This file: priorities, open items, and what is deferred.
6. Notes marked CURRENT, NEAR, or ROADMAP in the register.
7. Everything else is historical. Do not act on it.

## State at 24 Oct 2026

Two kinds of state move at different speeds. Read them separately.

- **Storage is stable for the current work.** On 24 Oct the owner said the in-flight changes will change the version and some UI, but not storage. Storage facts in these notes are current until a storage change is scheduled.
- **The version and the UI are moving.** Another session is changing the working tree, and its build outputs were rewritten at 19:50 on 24 Oct. Do not take a version number or a UI description from these notes as the state of the working tree. Read `package.json` and the source.

Committed state: HEAD is `bfbcee5` (v1.6.1585). The last `v` tag is `v1.6.1558`. Tag `pre-completed-log-refactor` marks `4489864` (1.6.1575). Nothing is tagged from 1.6.1559 to 1.6.1585. Commits and tags are the release record (AGENTS.md).

Main changes since 15 Oct, from the commit log:

- 1.6.1435 (`8b245a1`): progress moved to session memory. Queue-only passes read live progress. The old progress keys are removed once at startup.
- 1.6.1436 to 1.6.1437: the orphan sweep reads live progress. The nuked and pending space maps are stored as 32 hash buckets each (`dd46761`).
- 1.6.1438 to 1.6.1447: the flight recorder reports bytes written. The run list went to buckets (since superseded by the log). Blocked and orphaned worker tabs are closed sooner. No-response probes record tab state. A runs gap check, a write-size card, and one activation record per activation.
- 1.6.1442 (`7068380`): coordinator events go to the flight recorder. The stored events key is no longer written.
- 1.6.1459 to 1.6.1469: shadow count of deep pending rows; classification reuse; a blocked-page event acts on a queued tab.
- 1.6.1558 (`b20be9e`): runs are stored in the shared log. Space map buckets. The old bucket path for runs is still in the code, and its excise is decided.
- 1.6.1575 (`4489864`): terminal progress is saved in one shared write. Job count and flight card sort.
- 1.6.1585 (`bfbcee5`): the arrival-order option in the storage engine. Reuse of unchanged checkpoint pieces. Erase closes writes until reload. The worker does not use the arrival option yet (see "Deferred follow-up").
- `05e9132`: a new activation's clock starts when a row becomes active again.

Verification: the last full test run recorded in the notes was 1,315 ok, exit 0, before the 25 Oct edits (dead-ends review). The packaged builds did not match the source on 25 Oct. The notes record no live run since then. A build and a live run wait for the owner's go.

## Decided, next (owner decisions, not started as of 25 Oct)

1. **Excise the run-list bucket path, with no import of old data** (decision 2). Remove its readers, the gap watch, and the run part of the startup migration. Point the dev tools at the log reader. Each removal needs a dependency check and its tests.
2. **Remove the shadow checks** (decision 3): the progress shadow log, the coordinator-authority shadow log, and the deep-pending compare. Keep the flight recorder's persisted snapshot, and remove the analysis-only events that feed it (decision 5).
3. **Cruft and constants** (decision 6; the dead-ends review, Appendix C): the empty erase keep-list; a write-only variable; a stale comment. Layout constants go to the storage key module. Timing and cap values go to the tunables file. Remove the default of 1 in the bucket helpers.
4. **Fresh-start cleanup**, after item 1: remove migrations, repairs, and legacy readers that a fresh start does not need (dead-ends review, section 7). Each one needs a dependency check.
5. **Outlier recording limit: 3.5 seconds or more, future recordings only, on top of both old rules** (owner, 24 Oct: "an occasional 3 isn't a problem, but 3.5 or more starts to smell"; replaces "over 3 seconds"; wording tentative, confirm before building). All rows count toward the average (owner, 24 Oct). Existing entries are not cleaned up (owner: not concerned about them). Not started. Plan: [outliers plan](docs/outliers-plan-2026-10-24.md).
6. **Outlier events persist with their outlier until Clear** (owner, 24 Oct: "we'll want them to persist with the outlier until cleared"; size and format do not matter, since outliers are rare). Scope: the same target profile (owner, 24 Oct, tentative), plus storage and checkpoint writes (disk writes) inside the outlier's time span (owner, 24 Oct: "disk writes, yes, as they can perturb"). Copied at terminal, with no later events (owner, 24 Oct). Not started.
7. **Outlier list: terminal rows only** (owner, 24 Oct: "fair cop, but if they do terminate, we'll get them"). Running rows are not listed. Not started. Plan: [outliers plan](docs/outliers-plan-2026-10-24.md).
8. **Outlier records are for diagnostics and root-cause analysis, not audit** (owner, 24 Oct). Completeness can be approximate. Not started. Plan: [outliers plan](docs/outliers-plan-2026-10-24.md). Plan: [outliers plan](docs/outliers-plan-2026-10-24.md).

Legacy stored copies on existing profiles are not deleted. Owner, 25 Oct: ignore for now.

## Deferred follow-up: WAL-order storage

Captured on 24 Oct at the owner's direction. Performance is acceptable, so this is follow-up work to capture, not to fix now. Storage is not part of the in-flight version and UI work.

**The intended design** ([completed-log-shards-plan-2026-10-25.md](completed-log-shards-plan-2026-10-25.md)): one engine for the queue, runs, and terminal history. Checkpoint pieces are kept in arrival (WAL) order, so a burst of changes lands in one piece. Expiry drops whole pieces: runs and history by age, and history also by count. Clear drops the pieces.

**Owner, 24 Oct (to confirm):** separate WAL and checkpoint sets for each area (queue, runs, history), not one shared set. The shared set came about by moving runs into the shared WAL on 24 Oct (commit `b20be9e`), which predates the 25 Oct plan; pruning one area inside a shared set is the difficulty.

**What is in place** (checked in the code on 24 Oct):

- The queue's change log is written in arrival order, as numbered records in write-once segments. That part already matches the intent.
- The engine has the arrival-order option (commit `bfbcee5`). It is used only when a caller passes a function that places each row. Only the storage tests do.
- The worker's checkpoint still splits rows by key hash into 10 pieces.
- Unchanged pieces are skipped on a checkpoint. The commit describes this as working only on the first checkpoint after a load, because the record of what is stored is cleared after each save.

**What is not in place:**

- Plan steps 4 to 7: a queue shard id on each row, and the one-record move to the tail; runs and history on the in-memory index with arrival-order pieces; history and the duplicate check reading that index; clear dropping pieces; the live check of bytes per checkpoint.
- Whole-piece expiry. Pruning today works row by row. For example, the remembered space-post map is pruned by age and count.

**Why the worker has not switched:** an arrival-order checkpoint refuses keyed reads from disk, by design. So each store must answer reads from memory before it switches. That is the plan's own order.

**Known issues left in `bfbcee5`** (the commit's own list; not fixed):

- After every switch the remembered pieces are forgotten, so reuse happens only on the first switch after a load.
- The reader no longer checks a piece's snapshot number against the manifest.
- A checkpoint written with reused pieces may not read back in an older build.

**Open for the plan:** piece size (about 16 KB compressed, to confirm), and whether every path that returns a row to queued is audited before step 4.

**To pick this up:** the owner schedules it, or performance stops being acceptable. Until then, do not change the layout in pieces.

## WAL and checkpoint: open items (consolidated, 24 Oct)

One list of the open items in this area, gathered from the sections above, loose ends 16 to 19 and 28 to 30, and the roadmap. Nothing here is new or decided. Suggested order, from the storage plan's own text: decide the design points, fix the known issues in the last WAL commit, do the steps store by store with reads from memory before each switch, then the live check, then the throughput decay.

**Design decisions (owner)**
1. Separate WAL and checkpoint sets per area (queue, runs, history), or one shared set. To confirm (Deferred follow-up).
2. Whole-piece expiry: runs and history by age, history also by count. Clear drops pieces. Pruning is row by row today.
3. Pending staging: design choices C2 to C15, with C10 as the owner's question (roadmap).
4. ERASE on upgrade for storage changes. Undecided (flight recorder plan, section 9).

**Not yet built (storage plan steps 4 to 7)**
5. A queue shard id on each row, and the one-record move to the tail.
6. Runs and history on an in-memory index with pieces in arrival order; history and the duplicate check reading that index.
7. Clear dropping pieces.
8. A live check of bytes per checkpoint.
9. Each store answers reads from memory before it switches, because an arrival-order checkpoint refuses keyed reads from disk.

**Known issues in the last WAL commit, not fixed**
10. Reuse is forgotten after every switch, so reuse happens only on the first switch after a load.
11. The reader no longer checks a piece's snapshot number against the manifest.
12. A checkpoint written with reused pieces may not read back in an older build.

**Correctness items**
13. A late write after the last re-read in the stored-work clear (loose end 16).
14. The completed-row read in the clear is not measured (loose end 17).
15. Clear current work leaves pending records behind: 3,368 on the dev profile, 724 orphaned (loose end 19).
16. The storage layering phases are dated 11 Oct and were not re-verified (loose end 18).

**Measurements and other**
17. Session storage headroom, about 9.25 of 10 MiB on dev data, not measured live (loose end 28). Needs the owner's go.
18. Progress copies: about 30 writer sites in the worker and 10 in the content script (loose end 29; no change now).
19. The `worker-writer-design` branch (12 commits) moves the write door into a Worker (loose end 30; owner decision).
20. The throughput decay investigation waits for the items above (planning item 39).

**Adjacent, decided but not started:** decided items 1 to 4 (the run-list bucket path, the shadow checks, cruft and constants, then fresh-start cleanup).

**Parked:** Recovery B, IndexedDB and SQLite (nothing adopted), and legacy stored copies (not deleted).

## Roadmap (direction, not scheduled)

- **Big-ticket features we are approaching** (owner, 24 Oct). Listed in the owner's order; no design work has been started on them, and their order against the WAL and checkpoint items is the owner's call.
  - **Shared moderation.** Users share block work without any shared source becoming a command authority; local policy always decides. Design: [shared-moderation-publication-design-2026-05-18.md](shared-moderation-publication-design-2026-05-18.md). Runtime boundary: [shared-moderation-runtime-boundary-handoff-2026-05-20.md](shared-moderation-runtime-boundary-handoff-2026-05-20.md). See also the shared moderation runtime item below. Review of these notes (25 Oct): [shared-moderation-review-2026-10-25.md](shared-moderation-review-2026-10-25.md). Planning only (owner, 25 Oct: "NO CODING, planning only"). The owner is updating the May notes.
  - **Action entries for unmute and unblock** (owner, 25 Oct: "we should have action entries for unmute/unblock, yes"; planning only, not started). The queue carries pardon work as one combined kind, so the kind does not separate an unmute from an unblock. This corrects the 25 Oct provenance answer: pardon rows do exist, but they are not separated. Two checks come before any entry is trusted, both unconfirmed. First, the page settles a finished row as a block whatever its kind, so a finished unblock still in the live queue could be read as a block. Second, the settled progress labels every row as mute-and-block. The publication design already exports both removals by default.
  - **Provenance for posting: space, individual, reason** (owner, 25 Oct: "we'll want to know what space and individual put it in our notice, and what the reason category was"; discuss first, not started). Today the Space is kept only where the find came through a Space feed or a run started on a Space page. The individual is not found in the stored evidence. No moderation reason is stored; the evidence's resolution reason says how a profile was found, not why it was listed. Name the new field "reason", because "category" already means asset, target, or neutral. Capture comes before publication. Candidate reasons, as the owner listed them: CSAM, Adult, Troll, Spam, CatFish, RWNJ, LWNJ; then Scam, Impersonation, SockPuppet, Harassment, Hate (covers racist), Slop, Plagiarist, EngagementBait, and RageBait (owner, 25 Oct). The Blockzooka notes in the repo confirm red, yellow, and green verdicts and CSAM and spam reds. Its follow-up 3 recommends a reason code in the journal schema. The other names are not in the repo. Owner answers (25 Oct): (1) Yes: one reason per Space, with a per-item override as a drop-down on the red mute-block button and on the mute-block-close button. (2) Our reason list is always a superset of Blockzooka's list. What its list contains, from two summaries of its public agent notes (the exact names still need checking against the raw file): reports after blocking are Spam and Sexual exploitation of minors; its red criteria are 26 names, such as Identity fraud, Romance-bait solicitation, Racist content, Troll account (zero-history provocateur), and Clearly disruptive; its yellow indicators and outcome labels (Green, Unverified URL, rate-limited pause) are not reasons. Equivalence mapping (owner, 25 Oct): "Sexual exploitation of minors" is CSAM. The superset holds through a mapping from each Blockzooka name to one of ours. Spam matches exactly. Troll account (zero-history provocateur) is Troll (owner, 25 Oct, confirmed). The criterion "Sexual abuse material" covers child material and violent material targeting adults: minors involved is CSAM (owner, 25 Oct); adult material without minors is a different category, with Adult proposed, to confirm. Adult, CatFish, RWNJ, and LWNJ have no Blockzooka match. The other red criteria each need a mapping decision. Our list copies the names; nothing reads its list at runtime (its note). The row-by-row mapping is in [blockzooka-red-list-mapping-2026-10-25.md](blockzooka-red-list-mapping-2026-10-25.md). Open: does the superset cover the red criteria and reports only, or the outcome labels too? (3) Yes: the individual is the author of the listing post, until we decide otherwise. Still open: (4) CSAM: its note says any handling of that material needs legal review, and asks whether CSAM handling is in scope at all; (5) publication: whether reasons, and the individual, appear in a public journal. Publishing who listed whom may expose that person to the target.
  - **Reason decisions (owner, 25 Oct).** The Asset button gets a dropdown for the Space's default reason, shown as Asset-<type>. Some reasons are narrower than others: Plagiarist is a narrowing of Slop, and CatFish is narrower than Impersonation. Decided mappings: threats and doxxing go to Harassment (spelling to confirm); the template-permutation question farm goes to Slop; bot behaviour goes to SockPuppet; extraction goes to Scam; identity fraud goes to Impersonation. Names are matched case-insensitively and spelled one consistent way; human display may add spaces, and constants do not (owner, 25 Oct). RageBait is frequently political, as RWNJ and LWNJ are (owner, 25 Oct). The journal JSON may carry several categories per item, and a narrower category includes its broader one (owner, 25 Oct). Content farm is Bot, the owner thinks (tentative, 25 Oct). The Target button gets the same default-reason dropdown as the Asset button (owner, 25 Oct). Still open: whether a narrower reason counts as its parent in reports and publication; whether "Harassment" or "Harrassment" is the consistent spelling; whether RageBait nests under EngagementBait. Outcome labels (owner, 25 Oct): Space labels are confirmed (Red Spaces are target, Source Spaces are asset, Green Spaces are neutral). Green probably is the whitelist, and verdicts and outcomes probably stay out of the journal. Quora bans are not tracked. Three separate fields are undecided. Association-based blocking is current practice (the owner frequently blocks contributors to a space), so the Blockzooka rule against it is not adopted; not decided. Association as a basis, and confidence, are parked (owner, 25 Oct: not ready to go there yet). The mapping note has the detail. The row-by-row mapping is in [blockzooka-red-list-mapping-2026-10-25.md](blockzooka-red-list-mapping-2026-10-25.md).
  - **Posting our blocks into Spaces.** Export blocks to a Quora Space the user chooses. The 2.0 draft narrative lists it as release-candidate work ([release-summary-1.6-aka-2.0.md](release-summary-1.6-aka-2.0.md)). Not built.
  - **Importing others' blocks in the regular form.** Import public shared blocks from other people's Spaces, with a parser for shared posts, storage of where each import came from, and local review and execute controls (same summary). Not built.
  - **Blockzooka integration, exploitation and interoperability.** Context: [blockzooka-synergy-2026-10-12.md](blockzooka-synergy-2026-10-12.md) (design context and cautions, from a read-only review of the public repo), [blockzooka-writeup.md](blockzooka-writeup.md), and [blockzooka-red-list-bloom-2026-10-14.md](blockzooka-red-list-bloom-2026-10-14.md). The Blockzooka question in identity (loose end 7) is still unanswered.
- **Platform scope** (owner, 24 Oct, leaning): Chrome, and Brave and Edge to the extent they accept Chrome extensions (owner, 24 Oct), only, to demonstrate shared and network moderation before expanding platforms. Firefox is parked: the store account password was forgotten, recovery is slow, and store updates are blocked, so the listing stays on 1.2. The market share may not justify it. iPhone and macOS are parked: they need hardware the owner does not have. Firefox code stays in the repo, with no Firefox builds or uploads until the account is recovered and the owner asks. AI can do the lifting where a platform is worth it, but it cannot recover an account. The iPhone plan stays a separate future plan.
- **Dry-run mode for landing checks.** Designed, not built. First trace every path that starts a tab from the claim step. The check must read the page's own identity, not only the URL (review 5, R5-2).
- **Owner decisions open:** the pause ordering ([pause-owned-tab-order-options-2026-10-18.md](pause-owned-tab-order-options-2026-10-18.md)) and when a blocked tab may close ([window-slot-release-options-2026-10-17.md](window-slot-release-options-2026-10-17.md)).
- **Design choices still open:** pending staging, C2 to C15 (C10 is the owner's question); unified-store behaviour, A3 to A23 (the storage shape is replaced by the 25 Oct plan); flight-recorder events, B2 to B15; progress, D3 to D9.
- **Projection cost:** whether finished rows belong in the content index. Needs a live run.
- **Alternate storage engines (IndexedDB, SQLite):** probed on 11 Oct, in `experiments/`. Nothing has been adopted, and no work has been done on either (owner, 24 Oct). No decision is recorded, and nothing is scheduled.
- **Recovery B** (a worker-side copy used to recover a torn checkpoint): parked until shown to be needed (owner, 25 Oct).
- **One resident progress copy in the worker**, with the content copy as a cache keyed by a generation number. Later. Not critical (owner, 25 Oct).
- **Session-storage measurement** on a live profile, with the queue paused. Needs the owner's go. The estimate is about 9.25 of 10 MiB.
- **Preload the next queued tab.** Planning only. The 24 Oct update shows a handoff of 0.37 s, which weakens the case. Decide with measurements.
- **Timeouts:** merge the timeouts file into the tunables file, count hits for named timeouts, and show them on the dashboard (14 Oct plan; not started).
- **Background page surface:** remove it once the reconciler and the WAL scheduler run reliably without it.
- **Profile search toolbar** stays usable while work for the same search is pending (parked UI item; [user-note.md](user-note.md)).
- **Space-page redraws** (UI): four stages. Stage 1 is marked "this build", and the 25 Oct review says it may be active in another session. Owner to confirm.
- **Shared moderation runtime integration:** after queue authority is stable, local policy first. The pure model exists; no runtime file uses it. Planning only (owner, 25 Oct): no coding until the review's decisions are settled.
- **Labeler, atproto, and Blockzooka notes:** external context and cautions. No decision.
- **iPhone Safari:** a separate platform plan; the first version is limited to foreground actions.
- **Upgrade regression and more fuzz tests:** plans. The regression tool exists.
- **2.0 release narrative:** draft.
- **The sw.js split** (housekeeping list): the storage, dashboard, and preferences modules exist. The rest is not scheduled.
- **Whitelist of people we never block** (owner, 25 Oct; planning only, not started, not scheduled). No whitelist exists in the code or the notes (checked 25 Oct). The repo's other allowlists are lint and schema checks, not block exclusions. First concept (owner): collect the active posters in asset spaces as the tool encounters them, and keep the list in memory only, with no persistence. Asset spaces are the trusted spaces in [nuclear-source-enrollment-note.md](nuclear-source-enrollment-note.md). The list is a backstop against wrong blocks. It does not fix the classifier.
  Answered (owner, 25 Oct):
  1. Active means observed as a poster in an asset space. No minimum count and no recency test.
  2. Trust covers every observed poster in an asset space. Posters observed in target spaces are not whitelisted.
  3. Every automatic block checks the list. A manual block is allowed for a listed person.
  Open:
  4. Conflicts: when a listed person also matches a target space or an imported block, which one wins. Captured only; no decision.
  5. Lifetime is a flaw in the concept. Worker memory can be lost when the browser restarts the service worker, which can happen without a browser restart. The list cannot be rebuilt from stored state, so the first block after that could hit a listed person not yet seen again. Session storage would survive a worker restart, but it draws on storage that is already near its limit (about 9.25 of 10 MiB on dev data, not measured live). This may call for a dedicated Worker, not a service worker (see loose end 37). The flaw may also call for persistence, which raises further questions (below). Planning only; no change now.
  6. Whether the owner can view and remove a name. Not in the first concept.
  Persistence raises these questions. None is discussed or decided:
  - Where it is kept, and whether it shares the storage the other stores use (see the store table in architecture.md).
  - Who writes it. The repo's lint forbids storage writes from page code, and collection happens on pages, so names must reach the worker. A page's memory ends with the page.
  - Whether it belongs to the browser profile or to the Quora account the blocks are made from.
  - How big it may get, and whether it needs a cap or pruning.
  - Whether Clear History, Clear All Stats, or erase removes it.
  - Whether it may ever be exported or shared. Shared moderation keeps local policy in control.
  - What is kept about each name: identity only, or also when and where it was seen.

## Loose ends (open)

Carried from 15 Oct, with new items from 24 Oct. Each is an owner decision or later work.

Before any live run:

1. **Build and release record.** Tags are missing for 1.6.1470 to 1.6.1557 and 1.6.1559 to 1.6.1585. A release build waits for the owner's go, then a commit and an annotated tag (AGENTS.md).
2. **Past-block audit** (owner). Compare the profiles the tool blocked with the Quora block list. Look for a blocked profile whose name is a cut prefix of a longer slug.
3. **Profile search.** Keep it out of the first live run. Decide whether its match becomes exact before a later run.
4. **The live queue.** Check it for resolution rows left by older runs.
5. **The stop rule.** In a canonical-only run, the scored-resolution count must stay at zero.

Identity and landing:

6. **Dry-run mode** (see Roadmap).
7. **The query in identity.** Dropped, on the owner's view. The Blockzooka question is unanswered, and the draft reply is unsent.
8. **Rows stored under cut keys.** Re-key them from source pages, or clear them. Owner.
9. **Medium candidates** are queued and nuked with no per-candidate check. Read the first lists.
10. **Trailing punctuation** is stripped from text URLs before identity is taken. Check that no slug ends in those characters.
11. **Whitespace** is not trimmed, as the rule says. Owner to confirm.
12. **Manual requeue of "did not land" rows** can requeue the same link. Owner to decide whether to hide it.

Resolution and retry:

13. **The scored scan** decides profiles for resolution rows on question pages and space posts. Decide after the counts whether question pages may keep it.
14. **The `mb_op=1` navigation** to a scored guess. Deferred.
15. **"Did not land" for resolution rows.** Confirm that the rule ending canonical rows should also end these.

Clear and storage:

16. **A late write after the last re-read** in the stored-work clear. Only the milestone path rejects a missing row; the other writers are not checked.
17. **The completed-row read in the clear** is not measured.
18. **Storage layering phases.** The phase boxes date from 11 Oct and were not re-verified.
19. **Clear current work leaves pending records behind.** The 18 Oct audit found 3,368 pending records on the dev profile, 724 of them orphaned. This is the likely cause. The pending-staging design is open.

Other review items:

20. **Sender roles (R3-3).** Option C is documented. Option B waits until the eleven unknown senders are traced.
21. **The latch rule** (review 2, item a): decide once the counters have data.
22. **The pause residual** (review 2): leave it until a teardown count exists.
23. **Hit counts for named timeouts:** not built.

Not verified against live Quora (settled by a live run):

24. What Quora serves for fullwidth, trailing-hyphen, suffixed, lower-case, and query links.
25. Whether a profile page exposes its own identity, and where.
26. What Quora does with a canonical link that does not land on a profile page.
27. The page-data scan on a real page.

New, from 24 Oct:

28. **Session storage headroom** is not measured live (about 9.25 of 10 MiB on the dev data).
29. **Progress copies:** about 30 writer sites in the worker and 10 in the content script. Open, no change now (owner, 25 Oct).
30. **Unmerged branches:** `worker-writer-design` (12 commits) and four worktree-agent branches. Owner decision.
31. **Repo hygiene.** Done on 24 Oct: junk and swap files, `tmp/` build logs, and the experiment profile copies were moved out of the repo into a quarantine folder. Thirty-two retired CDP helpers were deleted (restorable from git). The list is in [removed-2026-10-24.md](historical/removed-2026-10-24.md). Still open: `.claude/` at about 1.2 GB, and deleting the quarantine folder, which the owner decides.
32. **Working-tree changes by another session** (version and UI). Do not overwrite. Do not run stash or checkout on `shared/js/sw.js`.
33. **Outlier recorder events** (owner, 24 Oct: "anyway, once we decide to keep one, I want the recorder events"). Reading to confirm: once an outlier is kept in the list, its recorder events are kept with it and shown on click. Decided as item 6: the events persist with their outlier until Clear, scoped to the same target profile and to storage and checkpoint events inside the outlier's time span. Answered 24 Oct: no later events, and disk writes are in. Open (plan, section 5): the timing for long rows, whether the working tab is a subject, and whether running rows are listed. Plan: [outliers plan](docs/outliers-plan-2026-10-24.md).
34. **Long real waits and the average** (live, 24 Oct). Two rows of 1 h 14 min are probably accounting artifacts, not waits (owner, 24 Oct; loose end 36). While they stay in the average, the spread test flags only rows over about 8 to 12 minutes, until Clear All Stats. Open, to cogitate: how to window the outlier criteria for the long tail of big outliers (plan, section 5, question 1).
35. **Long rows lose their events** (live, 24 Oct). The recorder holds about eight minutes at the live rate, so a long row's early events are gone by terminal. A row timeout would fix it (plan, section 5, question 2).
36. **Duration accounting** (owner, 24 Oct: "I think the 1 hour outliers may be accounting errors"; "the run hadn't been running for 20 minutes"). The two 1 h rows imply an activation at the run's creation time, 8:52 PM. Path A, a requeued row keeping its earlier start, is fixed in commit 05e9132 and in the dev build of 22:08. Path C, the queued-target resolution keeping `item.activeAt || now`, is not fixed and is the candidate route. Path B, terminal time taken from the tab close, is not fixed. Owner decisions: a go for the path C fix; Clear All Stats once the fix is confirmed (it also resets other stats). Plan: [outliers plan](docs/outliers-plan-2026-10-24.md), section 8a.
37. **Heartbeat and worker lifecycle** (owner, 24 Oct: keep the heartbeat open). A service-worker timer did not survive a restart in the 21 Oct probe; a dedicated Worker on a hidden extension page kept a 1 s timer for 35 minutes. The write-door move to a dedicated Worker (decided 20 Oct; unmerged; Firefox untested) would change where the recorder and resident state live. Plan: [flight recorder plan](docs/flight-recorder-display-plan-2026-10-24.md), section 7b; [experiments findings](experiments/findings-2026-10-21.md), sections 1 and 9.
38. **Features first?** (owner, 24 Oct: "this entire discussion is very fine tuning ... we may not do any of this if I decide to go after features first"). Owner, 24 Oct: expects to complete the current queue and Nuke 'Em work first; unclear whether to release without shared moderation (the 2.0 draft lists export, import and the shared-post parser as release-candidate work). Undecided on features first. The owner's acceptance criterion was 12 blocks a minute, and the owner reads about 40 a minute. The dashboard's seconds-per-block figure read 2.07 at 22:55 (about 29 a minute); to reconcile. Tuning items (windowing, decay and histogram, heartbeat, lifecycle events, the Worker question, card filters) would be parked. Kept near-term: the duration accounting fix (path C, section 8a of the outlier plan), which the dashboard averages need. The completed count fell from 626 to 226 between 22:15 and 22:55; cause not known.
39. **Throughput decay** (owner, 24 Oct). Working down a queue of 2,000+, the typical time per row went from under 1.0 s to about 2.00 s, read as the per-row figure the owner is tracking. The owner expects it to worsen as history approaches 10,000. Investigate after the WAL and checkpoint items, which come first. A decaying outlier baseline would follow such a drift (outlier plan, section 5, question 1).

## Historical and dead ends

- Historical notes are kept as records: the May 2026 refactor plans and handoffs, the 14 Oct review series, the codex reviews, and the September and October handoffs and live-test lists. Each carries a banner. Their open items were not carried forward unless they appear above.
- Dead ends, with reasons and sources: [docs/dead-ends.md](docs/dead-ends.md).
- Owner decisions in force: [coder-instructions-2026-10-20.md](coder-instructions-2026-10-20.md) section 2, and [dead-ends-review-2026-10-24.md](dead-ends-review-2026-10-24.md) decisions 1 to 8.
- Archive: all historical notes are in [historical/](historical/README.md). They were moved on 24 Oct, at the owner's request (dead-ends review, decision 7). Code comments that cited nine of them were updated to the new paths.

## Rules for future notes

- Start every new note with a status line: CURRENT, NEAR, ROADMAP, DEAD-END, HISTORICAL, or REFERENCE. Add it to [docs/notes-register.md](docs/notes-register.md).
- Decisions go into a dated decision list, not into a new plan. Number them the way the existing lists do.
- Before proposing a change in an area listed in [docs/dead-ends.md](docs/dead-ends.md), read its entry first.
- Moving or deleting notes needs the owner's approval.
- Code changes follow AGENTS.md: a version bump before any build, and a commit and annotated tag for each release.
