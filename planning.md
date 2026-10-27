# Mute Block Planning

Date: 2026-10-27. Rewritten on this date and checked against the code the same day; it replaces the 24 Oct version, which is in git history. This is the front door for the 1.6 line. Read this file first, then follow the links for detail. The status of every note is in [docs/notes-register.md](docs/notes-register.md). Dead ends are in [docs/dead-ends.md](docs/dead-ends.md).

> **Written as if the 1.6 closeout is complete.** Here, closeout means the items in the [closeout handoff](handoff-closeout-2026-10-25.md) are finished, or moved to "Carried into 2.0" below. Nothing under "Carried into 2.0" is treated as verified. Nothing in this rewrite is committed, tagged, built or run live, and the closing commit and tag do not exist yet.

1.6 is closed. The public release is `2.0`, built from the 1.6 source. The 1.5 notes are design history, not the place to start new work.

## Terms

The **Coordinator** (the historic name for the queue Worker) decides queue state. It calls out to two other parts: the browser side and the storage side. Today all three run in the service worker. They are kept apart in the vocabulary so they can be separated later. Separating them is not decided.

| Term | Meaning | Today |
| --- | --- | --- |
| **Coordinator** | Runs the scheduling state machine and holds the authoritative in-memory copies of what it needs. The only writer of the queue log. The one place that decides queue state. | Service worker (`sw.js`) |
| **Browser side** | What the Coordinator asks the browser to do: open, focus and close the background window and its tabs, and run actions in them. | Called from the service worker |
| **Storage side** | Reads and writes durable state: the queue log, checkpoints, and stored settings. | Called from the service worker |
| **Authoritative state** | State the Coordinator decides from: queue rows, completed rows, and runs (`architecture.md` 2.1). | Coordinator |
| **Other state** | Settings, the space list, the outlier list, and session copies and caches (`architecture.md` 2.2 and 2.3). Each is owned by the module that writes it, not by the Coordinator. | Preferences, space registry, content script, caches |
| **Dashboard, Preferences** | Pages the user sees. They hold their own settings and display state, and send requests to the Coordinator. They hold no authoritative queue state. | Extension pages |
| **Content script** | Runs on each Quora page. Holds page-local state, and reports claims, milestones and results to the Coordinator. It holds no authoritative queue state. | Quora pages |
| **Background window, background tab, background work** | Proposed user-facing names for the window, the tabs, and the work done in them. Not yet adopted in the docs. | Browser side |
| **Service worker** | Chrome's background script. Where the Coordinator runs today. | Chrome |

**Naming rules for docs**
- "Authoritative" means the Coordinator decides from it. A setting or a cache is not authoritative, even when it is stored.
- "Service worker" names only Chrome's background script. Write "the Coordinator owns the queue; in Chrome it runs in the service worker", not "the service worker owns the queue".
- Code names that blur these: `coordinator.js` and `coordinator.html` are the Dashboard page, not the Coordinator. `architecture.md` 1.1 calls the service worker the "authority". In docs, say "Dashboard" for the page, and "Coordinator" for the role.
- "Worker tab" and "worker window" are action surfaces, not the Queue Worker. **Open choice (owner):** rename them to "action tab" and "action window" in docs now (recommended), and leave the code names alone.
- **Dev mode** is a switch on the Dashboard, like the developer mode on the extensions page. It is a runtime switch, not a build. It shows the diagnostic panels (outliers, flight recorder save, metrics). These are not documented for users.
- Moving the Coordinator to another place (the worker-host idea) is hypothetical and not committed. The question it raises: Chrome can stop the service worker, and the Coordinator's memory goes with it. The 21 Oct probe showed a service-worker timer did not survive a restart, while a dedicated Worker kept one running for 35 minutes. Nothing in 1.6 or 2.0 depends on it until the owner decides.

## Which source wins

When notes disagree, the higher item wins:

1. The code, its tests, and the git history: what runs, and what was committed. Only the code is evidence of behaviour.
2. [AGENTS.md](AGENTS.md): build, version, test, and live-browser rules.
3. [architecture.md](architecture.md): the current model, constraints, and known tradeoffs. Checked against the code on 27 Oct; its statuses in sections 6.1 and 6.2 are current as of that date.
4. Dated owner decisions, in force until a later decision changes them: [dead-ends-review-2026-10-24.md](dead-ends-review-2026-10-24.md) (decisions 1 to 8, 25 Oct), [coder-instructions-2026-10-20.md](coder-instructions-2026-10-20.md) section 2 (decisions 2 to 33), and the closeout decisions in [handoff-closeout-2026-10-25.md](handoff-closeout-2026-10-25.md). A later date wins.
5. This file: priorities, open items, and what is deferred.
6. Notes marked CURRENT, NEAR, or ROADMAP in the register.
7. Everything else is historical. Do not act on it.

## Where 1.6 stands

- **Closing build:** 1.6.1655 (`package.json` and both manifests, 27 Oct). **Last commit on this branch:** `8e146cc` (v1.6.1636, 26 Oct). Everything after it is uncommitted: 84 entries in `git status` (27 Oct). No zip and no tag exists for 1.6.1651 to 1.6.1655 (dev build only); the closing commit awaits the owner's approval.
- **Release:** Chrome dev build only. No store zips. Firefox is parked, and its store listing stays on 1.2.
- **Storage:** every key carries the prefix `v1.6.`. The queue is a write-ahead log with arrival-order shards. Completed work is Recent History (90 days, 10,000 entries). Runs are capped at 700 by count only, with no age rule (26 Oct). The checkpoint has one manifest and one shard set per area (built 27 Oct).
- **Upgrade from 1.5.** The 1.6 layout never reads the unprefixed 1.5 keys, except once for the space classification registry, which transfers on upgrade (built 27 Oct). Everything else (queue, History, progress, remembered posts) starts clean. The old data stays in storage, unread, and Erase does not touch it. The public notes must say so.
- **Tests:** `npm test` and `npm run test:parallel`. 51 lanes at the last recorded run (26 Oct). Six lint scripts.

## 1.6 against 1.5

Baseline: `../mute-block-1.5`, branch `refactor/1.5`, snapshot `5188a99` (10 May 2026, package version 1.5.83). The 1.6 line starts at `0e07a3d` the same day. This branch has 325 commits since the snapshot.

### User-visible

**Added in 1.6**
- The toolbar icon opens the Dashboard. In 1.5 it opened the popup.
- Preferences is its own page and replaces the popup. It links to the Dashboard and to History.
- History: the completed-work log, with manual and space rows, error rows in red, sort by status, a text filter, a count, and Remove duplicates. Clear empties the page only. The filter and Remove duplicates are not yet checked in a browser.
- Manual Mute Block and Unblock on profile pages are recorded as History rows.
- Collect N More on space pages and profile-search pages. The count is per page and kept in memory (choices 25 to 1000, default 100), with a Stop collecting button.
- Profile-search pages can queue Nuke 'Em work. The 1.5 readme lists Nuke 'Em on people lists and space feeds.
- Worker window: queued tabs run in a dedicated window. Activate is the working mode and the default. The Worker Window Focus setting still offers Focus and None, which were diagnostic modes (see Decisions and Carried).
- Dashboard summary cards: Terminal, Avg item time, Avg page load, and a queue progress bar.
- Erase Everything (Preferences): a typed confirmation, and refused while work is running.
- Hover help on Dashboard and Preferences controls, starting "Mute Block extension:".

**Changed**
- Space classifications (Asset, Neutral, Target) moved from the popup to Preferences as Categorized Spaces. The list is the same, and it transfers on upgrade (decided 27 Oct; built as a one-time import at startup).
- Remembered space-post results (1.5: kept until cleared from the popup, pruned by age and count) became completed profile history. The limits are Recent History Retention (default 90 days) and Recent History Entry Cap (default 10,000).
- The queue belongs to the queue Worker (in Chrome, the service worker). The Dashboard shows Current Work and Runs. Work is meant to continue after the Dashboard closes or pages reload. The closeout notes do not record a live check of that.
- Profile identity is case-exact. A fixed set of trailing tokens is removed when a key is formed (`-log`, `-answers`, `-questions`, `-posts`, `-share-N`, `-ch-N`). Rows written earlier keep their old keys.
- Runs are capped at 700, hard-coded. The oldest time-day shards go first, except a shard that a queue row still refers to.

**Kept as in 1.5**
- Mute Block and Mute Block Close; the Original Poster button; bulk Open Profiles and Nuke 'Em on people lists; the FOP delay and flip settings; Profiles Per Batch.

**Removed or no longer offered**
- The toolbar popup.
- The remembered-post list and its Clear control.
- Retry Failed on the Dashboard (1.5 had it). The 1.6 build also removed requeue of failed and cancelled rows (25 Oct, `0209f52`). Idle Retry has no control in 1.6. The 2.0 draft claimed both, and was corrected on 27 Oct.
- 1.5 data is not migrated, except space classifications (see Where 1.6 stands).
- Not in 1.6, planned for 2.0: export and import of shared blocks, and the shared-post parser.

### Internals

**Added in 1.6**
- The queue Worker owns the queue (in Chrome, the MV3 service worker). It is stored as a write-ahead log with checkpoints, in two slots (A and B). Queue rows carry a job envelope: job key, action kind, subject, scope, and attempt identity.
- Arrival-order shards are the only layout. Each shard is about 16 KB of uncompressed JSON. Completed rows are pruned by whole shard, by age and by count. Runs are kept in time-day shards.
- Storage namespace: every key carries the `v1.6.` prefix. Erase clears prefixed keys only.
- Progress lives in session memory and is lost on browser restart. The old progress copies and the old content-index copy are removed once at startup.
- Queue state machine (events, handlers, dispatcher), reducers, reconcile, retry, and terminal settlement.
- Diagnostics behind the Dashboard's dev-mode switch: the flight recorder (a snapshot of up to 2,000 entries), the outlier detector (outliers are recorded at 3.5 s or more, with their recorder events kept), and metrics (Metrics, Scan cost, Phase timing, Write sizes, Recent event counts). Internals only. Not documented for users.
- Session storage: the WAL mirror holds the queue's shards and the WAL tail only; completed and runs shards are not mirrored (built 27 Oct). The outlier list and the progress records are also kept in session storage. Measured once by hand on 26 Oct at 8,880,912 bytes, about 85% of the 10 MB quota, before that change; not measured again. The code has no session quota check.
- Tunables, timeouts, design tokens, and storage keys each have their own module.
- Tooling: live checks use CDP only (no Puppeteer). New folders: `tools/` (CDP helpers, mock Quora, Firefox BiDi harness, parallel test runner), `docs/`, `historical/`, and `experiments/`. `architecture.md` is new (about 770 lines).
- Tests: 54 entries under `test/`. 1.5 had one.
- Manifest: adds `unlimitedStorage`, `alarms` and `scripting`, with no new hosts. Adds a fixed `key` (commit `ebf6a10`, "Chrome store-id build"). The action no longer has a popup. Not checked whether Chrome shows a prompt for the new permissions; check before the store update.

**Scale**
- `sw.js`: 2,883 → 35,689 lines. Helpers moved into about 98 new modules under `shared/js`, but `sw.js` is still large and combines several responsibilities. The 2.0 draft names it as a release risk.
- `content.js`: 8,229 → 15,048 lines.
- `coordinator.js` (the Dashboard): 809 → 3,897 lines.

**Removed**
- The shadow checks: about 1,440 lines across the worker, tests and harness (`8e146cc`).
- The run bucket layout (`8d08054`).
- Space post maps, pending and remembered (26 Oct). `nukedPosts.js` still exists, and still writes the settle memory on space confirms.
- The raw 1.5 queue key (`mbCoordinatorQueue`) is guarded on write and removed at startup.
- `popup.js` and `popup.html` in source. The tracked copies under `chrome/` and `firefox/` are build output.

## Decisions in force from closeout (26 Oct)

- Recent History is the completed-work log. Manual blocks and unblocks are completed rows.
- Limits: 90 days and 10,000 rows, whichever is hit first. Pruning is by shard, so the limits are approximate.
- Run cap: 700, hard-coded.
- Clear on History empties the page only. Storage is untouched. A disk clear would be destructive and is not built.
- Only officially completed rows count toward the Terminal and Avg item time cards, since the last Clear All Stats.
- Identity is case-exact, with the trailing tokens above removed.
- Old unprefixed data is not migrated, except the space classification registry (decided 27 Oct; built).
- The Dashboard's dev-mode switch gates the diagnostic panels. Outliers and the flight recorder are not documented for users.
- Requeue and Idle Retry have no Dashboard control. Internal requeue of stale or lost rows stays.
- Error rows are red. History sorts by status.
- The Target Concurrency card is removed. The worker keeps its default of 4.
- Space post maps are removed. Decisions are per profile.
- Shadow machinery is removed.
- Worker window focus: Activate is the working mode (owner, 27 Oct). Focus is too intrusive. None does not work: queued actions need a manual raise. The three modes were for finding out what works.

## Decisions of 27 Oct, with status

- Checkpoint layout: one WAL and one checkpoint manifest, with a shard set per area (`area-v1`). Built.
- Completed log drop: one null key per dropped completed shard, written inside the checkpoint switch. Built.
- Runs drop: one `map.dropShard` record per dropped run shard; the storage delete happens at the next checkpoint. The owner accepted the drop record. Retention is by the 700-run cap only (26 Oct), not by age. Built.
- Session copy: the queue's shards and the WAL only. Completed and runs shards are not in session. The outlier key and the progress keys stay in session. Built.
- Recovery B is not parked: it is Recovery A (owner, 27 Oct). This changes the 25 Oct status. Recovery A, the session copy of a torn checkpoint, is used only when the disk checkpoint is torn; disk wins when intact. Built.
- Restart: when the disk and session queue-area manifests agree and the session copy is committed, the session queue is used and the disk WAL tail is applied; otherwise the disk path runs. Restart means a service worker restart. Built.
- Torn queue shard: the cheap session fallback (`recoverQueueShardFromSession`) is built and left in place. Torn-shard handling is otherwise ignored, because storage.local is SQLite and treated as reliable. No hash or decode check on load, and no write-back of repairs. Decided; not a build.
- Clear: Clear All Stats empties the display for completed rows and runs and sets the cutoff; storage for history, completed rows and runs is not touched. Clear Outliers clears the outlier rows on disk and in session and keeps the baseline. Built. The outlier baseline under Clear All Stats is an open conflict (see Owner decisions still open).
- Soft-fail: the visible line and the header counts are removed from the Dashboard. The stored flag, the worker side and the toggle plumbing stay. Built.
- 1.5 space classifications: one-time import from the plain key `mbSpaceRegistry` into the prefixed registry; 1.6 entries win on conflict; marker `mbSpaceRegistryImportedFromV15`; Erase keeps the marker and removes the plain key. Built.
- Queue-only checkpoint: refused when disk holds completed or runs shards. Closes audit item 1. Built.
- Dashboard first load: a spinner until the first state arrives; a failed or timed-out first load shows "History load failed". Built; not checked in a browser.
- Session quota: the 26 Oct measurement stays. The session mirror reduction is built (see "Where 1.6 stands").
- Outlier recording limit at 3.5 s: built (earlier, commit `5a41c99`).

## Carried into 2.0

These were open at closeout. Each stays open until it is checked.

**Built 27 Oct (was decided, not built)**
- Transfer of the space classification registry on upgrade. Built: a one-time copy from the 1.5 registry key (plain `mbSpaceRegistry`) into the prefixed key, guarded by the marker `mbSpaceRegistryImportedFromV15`. The old key stays until Erase removes it. Not yet run on a copy of a 1.5 profile. Build and commit follow the closing commit (AGENTS.md).

**Live checks not yet run**
- Manual Mute Block and Unblock, end to end: rows appear with the right status and outcome.
- History: filter, count, Remove duplicates, and sort, on a real profile.
- Save flight recorder (dev mode on): the file and the folder. It uses an anchor download, so the folder is the browser's default.
- Outlier highlight and gap column (dev mode on); outlier events kept with their outlier.
- Avg item time card holds steady; Nuke 'Em counts on space and search pages after queuing; the queue label holds during a batch.
- Stop collecting: alignment with Collect N More on space pages is unmeasured. The Next notification pill is not in the page, so its clearance is an estimate.
- Shard layout on a live store: bytes per checkpoint. The run cap and the completed-log prune, with short limits.
- Session storage against the 10 MB quota. Measured once by hand on 26 Oct, before the mirror was reduced to the queue (27 Oct). Nothing in the code checks it.
- Reload the dev extension and confirm the version it shows.
- Dashboard first-load spinner and the "History load failed" text, and the 1.5 space import on a copy of a 1.5 profile (27 Oct: not checked in a browser or on a profile).

**Owner decisions still open**
- Should the worker close tabs it skips as "profile unavailable"? Four such tabs were left open on the dev profile.
- Should manual blocks count in the Dashboard's blocked totals? Decide whether to exclude manual rows.
- Keep or remove the nuked-post memory written on space confirms. Nothing reads it for History now.
- `sourcePostKey`: remove it, or keep it as a copy. Queue rows already carry the post key in their evidence.
- Resolver-only posts (no profile yet) get no nuked judgement.
- Search pages do not use the in-memory marks, so pending state there has a gap. Space pages hold marks for a batch.
- Closed 27 Oct: the queue-only checkpoint path drops the completed map, so it is refused when disk holds completed or runs shards (`queueOnlyCheckpointRefused`). Audit item 1 (`audit-2026-10-27.md`).
- Whether to build a disk clear for the completed log. It would be destructive, and it is not built.
- Worker Window Focus setting (owner, 27 Oct: Activate works; Focus is intrusive; None needs a manual raise). Options: (a) remove the setting from Preferences, hardcode Activate, and keep Focus and None only behind dev mode (recommended; a code change); (b) keep the setting as it is. Related: architecture.md 6.1 item 11, open since 25 Sep.
- Clear Current Work and queued rows: the 27 Oct Clear rule does not cover queued work. Clear Current Work still removes queued rows through the WAL. Owner decision open.
- Clear All Stats and the outlier baseline: the code resets the outlier baseline to zero (`applyCoordinatorOutlierReset`). The 27 Oct owner note says the stored outlier key keeps its baseline counters, which is how Clear Outliers behaves. Owner to decide what Clear All Stats does. Architecture section 5.4.
- Startup spinner timeout: a first load that gets no answer from the worker shows "History load failed". The owner kept the timeout as a failure (27 Oct). Listed for confirmation.
- Import race: the background 1.5 import can race a concurrent write to the registry. Accepted (27 Oct). Listed for confirmation.
- Firefox and `build:chrome` zips: not built (owner: Chrome dev only for now).
- Commit and tag for the closing build.

**Storage follow-up (WAL and checkpoint)**
- Steps 4 and 5 of the completed-log plan are built and switched on: queue row shards with tail moves, and completed shards with limits applied to whole shards. Runs are time-sharded.
- Not built: steps 6 and 7. Runs and history would sit on an in-memory index, with History and the duplicate check reading it; Clear would drop pieces. Clear is page-only today.
- Built 27 Oct (decided 26 Oct): one WAL and manifest, with one shard set per area (queue, completed, runs), `area-v1`.
- Open: the tail-move audit (every path that returns a row to queued) is grep-scoped, not proven complete. The compressed shard size is unconfirmed.
- Owner rule (24 Oct): do not change the layout in pieces.

**Outliers**
- Built per commit `5a41c99`: the 3.5 s recording limit, the terminal-only list, and recorder events kept with the outlier. Not checked live.
- Not built: Phase 3 (row timeout). The baseline is cumulative. Phase 4 (full-field view) is hover text only.

**Cleanup**
- [architecture.md](architecture.md): corrected against the code on 27 Oct. The run excise (`8d08054`) and the shadow removal (`8e146cc`) are built, and sections 6.1 and 6.2 now say so.
- Stored keys with no live writer or no live reader (listed in the closeout handoff): decide whether to delete them. Among them: `mbCoordinatorIdleRetryEnabled`, `mbCoordinatorEvents`, `mbCoordinatorQueue`, `mbCoordinatorQueueView`, `mbCoordinatorContentQueueIndex`, `mbProfileNukeProgress`, `mbPauseDiagnosticSnapshot`, `mbEraseBlockHistoryGeneration`.
- The `tools/cdp` scripts that use the prefixed names have not been run against a live browser.
- [release-summary-1.6-aka-2.0.md](release-summary-1.6-aka-2.0.md): the requeue, Idle Retry, Ready to Run and queue-owner claims were corrected on 27 Oct. Still out of date: it cites source version 1.6.246, and it does not yet describe the space-classification transfer.
- `experiments/worker-host/` (about 940 MB) is git-ignored now. The editor swap file `.nits-8.md.swp` is to be deleted.
- Unmerged branches: `worker-writer-design` (12 commits) and four worktree-agent branches. Owner decision.
- Legacy stored copies on existing profiles are not deleted. Owner, 25 Oct: ignore for now.

## 2.0: the next line

- **Scope.** Proposed (27 Oct, see Moderation staging): 2.0 includes reasons, manual export, and review-only import. The owner still decides this. The earlier question, "features first" or "release without shared moderation" (loose end 38), is answered only if the owner says so.
- **Worker-host failover** is a gate, not built and not designed. Nothing may move queue work out of the service worker until it is designed (26 Oct gate). The service worker becomes a shim over browser APIs, not a shipper (27 Oct). Probes exist (Chrome P1 to P5, Firefox F1 to F6; `experiments/worker-host/NOTE.md`). There is no design.
- **Platform.** Chrome first (24 Oct). Firefox and iPhone are parked.
- **Version label.** Exactly `2.0.0`, or a number mapped from the 1.6 line? Open in the release draft.
- **Release copy** must state the upgrade rule (space classifications transfer; the rest starts clean), must not claim requeue or Idle Retry, and must say "available" only for what has landed. Shared import and export have not.
- **Ship criteria** (release draft): `npm test` and syntax checks pass; Chrome build and reload are clean; a small live CDP smoke pass.

## Moderation (27 Oct)

Detail is in the 27 Oct section of [shared-moderation-publication-design-2026-05-18.md](shared-moderation-publication-design-2026-05-18.md). That section holds the reasons rules, export tracking in history, the two export channels (public and private), trust and pardons, the Space-changes-hands edge, roaming, and the open questions.

Early phases, in order: reasons on queue and history rows; export tracking in history; manual export on the public and private channels; then review-only import. Dead Hand is out of 2.0. Version numbers are not assigned.

Open items that block the export phase are listed under "Open questions for export" in that section, and the live checks under "Live checks needed".

## Roadmap (direction, not scheduled)

Owner's order (24 Oct). No design work has started on these.

- **Shared moderation.** Users share block work without any shared source becoming a command authority; local policy decides. Planning only (25 Oct). Design: [shared-moderation-publication-design-2026-05-18.md](shared-moderation-publication-design-2026-05-18.md). Runtime boundary: [shared-moderation-runtime-boundary-handoff-2026-05-20.md](shared-moderation-runtime-boundary-handoff-2026-05-20.md). Review: [shared-moderation-review-2026-10-25.md](shared-moderation-review-2026-10-25.md). The pure model exists; no runtime file uses it.
- **Action entries for unmute and unblock** (25 Oct, planning). The queue carries pardon work as one kind, so an unmute and an unblock look the same. Two checks come first: whether a finished unblock still in the live queue reads as a block, and why settled progress labels every row as mute-and-block.
- **Provenance for posting: space, individual, reason** (25 Oct; discuss first). Today the Space is kept only where a find came through a Space feed or a Space-page run. No moderation reason is stored. Owner decisions so far: one default reason per Space, with a per-item override; the reason list is a superset of Blockzooka's. Mapping and open items: [blockzooka-red-list-mapping-2026-10-25.md](blockzooka-red-list-mapping-2026-10-25.md). CSAM is selectable as the user's own label (owner, 27 Oct: never set by us; it records the user's belief). Still open: whether reasons and the individual appear in a public journal, since that could expose the person who listed someone to the target. See Moderation staging.
- **Posting our blocks into Spaces.** Export blocks to a Quora Space the user chooses. Not built.
- **Importing others' blocks.** Import public shared blocks from other people's Spaces, with a parser, stored provenance, and local review. Not built.
- **Blockzooka integration, exploitation and interoperability.** Context: [blockzooka-synergy-2026-10-12.md](blockzooka-synergy-2026-10-12.md), [blockzooka-writeup.md](blockzooka-writeup.md), [blockzooka-red-list-bloom-2026-10-14.md](blockzooka-red-list-bloom-2026-10-14.md). Loose end 7 is still unanswered.
- **Whitelist of people we never block** (25 Oct, planning only). Concept: posters observed in asset spaces are trusted, kept in memory, and checked before every automatic block. Open: which rule wins on a conflict with a target space; the list's lifetime (worker memory is lost on restart, so the list cannot be rebuilt from stored state); and persistence. See [nuclear-source-enrollment-note.md](nuclear-source-enrollment-note.md).

Other directions:
- **Platform scope** (24 Oct, leaning): Chrome family only, to demonstrate shared and network moderation. Firefox is parked: its store account needs recovery. iPhone and macOS are parked (no hardware).
- **Worker-host ownership** (hypothetical, 25 to 26 Oct; not committed). One explored rule: the first-opened Quora or MB page hosts the queue Worker, and that host is sticky. Run permission lasts the browser's lifetime. See Terms.
- **Dry-run mode for landing checks.** Designed, not built. Trace every path that starts a tab from the claim step. The check must read the page's own identity, not only the URL.
- **Owner decisions open:** the pause ordering ([pause-owned-tab-order-options-2026-10-18.md](pause-owned-tab-order-options-2026-10-18.md)), and when a blocked tab may close ([window-slot-release-options-2026-10-17.md](window-slot-release-options-2026-10-17.md)).
- **Design choices open:** pending staging (C2 to C15) is partly moot, since pending records were removed on 26 Oct, so re-check first. Unified-store behaviour (A3 to A23) is superseded in part by the 25 Oct plan. Flight-recorder display (D0 to D8), recorder events (B2 to B15), and progress (D3 to D9) are open.
- **Projection cost:** whether finished rows belong in the content index. Needs a live run.
- **Storage engines (IndexedDB, SQLite):** probed; nothing adopted; nothing scheduled.
- **Chrome sync storage, as a possibility** (27 Oct; not decided). Best fit: all preferences data, plus space classification and Space reason defaults. All are small and rarely written. Limits: 100 KB total, 8 KB per item, 120 writes a minute, 1,800 an hour, so one item per Space and batched writes. Not for the queue, history or the journal. Remote changes follow the propose-only rule. Needs live checks: encryption, whether data follows the extension ID across a reinstall, and whether erase clears it on every device. Full design in [shared-moderation-publication-design-2026-05-18.md](shared-moderation-publication-design-2026-05-18.md) only if it becomes a moderation step.
- **Recovery B** is not parked (owner, 27 Oct): it is Recovery A, which is built (session copy, used only when the disk checkpoint is torn; `architecture.md` section 4.8). The 25 Oct worker-side copy is not in the code.
- **Session queue copy**: queue shards and WAL only in session; completed and runs out. Built (27 Oct) for the worker restart. The page-level copy is not built and waits on worker-host failover (see 2.0).
- **One resident progress copy in the worker**, with the content copy as a cache keyed by generation. Later.
- **Preload the next queued tab.** Planning. The 24 Oct update shows a handoff of 0.37 s, which weakens the case. Decide with measurements.
- **Timeouts:** fold the timeouts module into tunables, and count hits for named timeouts on the Dashboard. Not started.
- **Background page surface:** remove once the reconciler and WAL scheduler run reliably without it.
- **Profile search toolbar** stays usable while work for the same search is pending (parked; [user-note.md](user-note.md)).
- **Space-page redraws:** four stages. Stage 1 may be in another session; owner to confirm ([space-page-redraw-plan-2026-10-24.md](space-page-redraw-plan-2026-10-24.md)).
- **Shared moderation runtime:** after queue authority is stable, local policy first. Planning only until the review's decisions are settled.
- **Labeler, atproto and Blockzooka notes:** external context and cautions. No decision.
- **Upgrade regression and more fuzz tests:** plans. The regression tool exists.
- **The `sw.js` split:** the storage, Dashboard and preferences modules exist. `sw.js` is still 35,689 lines, so the rest is real work and is not scheduled.

## Loose ends (older lists, not re-checked)

From the 15 and 24 Oct lists. Only the still-open items are kept here; the full lists are in git history.

Before a live run:
- Past-block audit (owner): compare blocked profiles with the Quora block list. Look for a blocked profile whose name is a cut prefix of a longer slug.
- Profile search: decide whether its match becomes exact before a later run.
- Live queue: check for resolution rows left by older runs. Stop rule: in a canonical-only run, the scored-resolution count stays at zero.

Identity and landing:
- Trailing punctuation and whitespace: owner to confirm.
- Rows stored under cut keys: re-key from source pages, or clear them.
- Medium candidates are queued and nuked with no per-candidate check. Read the first lists.

Resolution and retry:
- The scored scan on question pages: decide once the counts are in.
- The `mb_op=1` navigation to a scored guess: deferred.

Clear and storage:
- A late write after the last re-read in the stored-work clear.
- The completed-row read in the clear is not measured.
- The storage layering phases are dated 11 Oct and were not re-verified.

Review items:
- Sender roles (R3-3): option B waits until eleven unknown senders are traced.
- Latch rule and pause residual (review 2): decide with counter data.
- Hit counts for named timeouts: not built.

Live Quora behaviour, not verified: fullwidth, trailing-hyphen, suffixed, lower-case and query links; whether a profile page exposes its own identity; what Quora does with a canonical link that does not land on a profile page; the page-data scan on a real page.

Engineering and process:
- Progress copies: about 30 writer sites in the worker and 10 in the content script. No change now.
- Duration accounting, path C: the queued-target resolution still keeps `item.activeAt || now`. Needs the owner's go for the fix. Path A is fixed (`05e9132`).
- Heartbeat and worker lifecycle: a service-worker timer did not survive a restart (21 Oct probe); a dedicated Worker kept a timer for 35 minutes. Owner: keep the heartbeat open.
- Throughput decay: time per row rose from under 1.0 s to about 2.0 s over a queue of 2,000 or more. Investigate after the storage items.
- Working-tree changes by another session: do not overwrite them, and do not stash or check out `shared/js/sw.js`.
- Repo hygiene: `.claude/` is about 1.2 GB. Deleting the quarantine folder is the owner's call.

## Historical and dead ends

- Historical notes are kept as records: the May 2026 refactor plans and handoffs, the 14 Oct review series, the codex reviews, and the September and October handoffs and live-test lists. Each carries a banner. Their open items were not carried forward unless they appear above.
- Dead ends, with reasons and sources: [docs/dead-ends.md](docs/dead-ends.md).
- Owner decisions in force: [coder-instructions-2026-10-20.md](coder-instructions-2026-10-20.md) section 2, [dead-ends-review-2026-10-24.md](dead-ends-review-2026-10-24.md) decisions 1 to 8, and the closeout decisions above.
- Archive: all historical notes are in [historical/](historical/README.md). They were moved on 24 Oct, at the owner's request (dead-ends review, decision 7).

## Rules for future notes

- Start every new note with a status line: CURRENT, NEAR, ROADMAP, DEAD-END, HISTORICAL, or REFERENCE. Add it to [docs/notes-register.md](docs/notes-register.md).
- Decisions go into a dated decision list, not into a new plan. Number them the way the existing lists do.
- Before proposing a change in an area listed in [docs/dead-ends.md](docs/dead-ends.md), read its entry first.
- Moving or deleting notes needs the owner's approval.
- Code changes follow AGENTS.md: a version bump before any build, and a commit and annotated tag for each release.
