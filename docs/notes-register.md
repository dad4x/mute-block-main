# Notes register

Status as of 24 Oct 2026. Every note in this repository, with one status each. Start with [planning.md](../planning.md). This page says what each other file is for and how far to trust it.

## Statuses

- **CURRENT**: in force. It describes the system as built, or rules that bind now. Keep it up to date.
- **NEAR**: decided or agreed, and next in line. Check planning.md for the order.
- **ROADMAP**: a direction, an option, or an open owner decision. Not scheduled.
- **DEAD-END**: tried and rejected, withdrawn, or declined. The reasons are in [dead-ends.md](dead-ends.md). Do not reopen without an owner decision.
- **HISTORICAL**: superseded, finished, or a point-in-time record. Kept as a record, in [historical/](../historical/README.md) unless the table says otherwise. Do not implement from it.
- **REFERENCE**: generated data, probe results, or reference documents. Dated. Check before relying on their numbers.
- **SCRATCH**: not a note. Stray, junk, or build-leftover files that were kept on purpose. Junk removed on 24 Oct is listed in [removed-2026-10-24.md](../historical/removed-2026-10-24.md).

## How this was applied

- Notes that are not current carry a status banner at the top, added on 24 Oct. Current documents carry their own status line. Scratch files and generated data have no banner, so this table is their only record.
- HISTORICAL notes were moved into [historical/](../historical/README.md) on 24 Oct, at the owner's request (decision 7 and Appendix A of [dead-ends-review-2026-10-24.md](../dead-ends-review-2026-10-24.md)). The nine that code comments cite were moved too, and those comments now name the new paths. What was removed on 24 Oct is listed in [removed-2026-10-24.md](../historical/removed-2026-10-24.md). Each row says where a note is.
- Dates are the ones written in each note, or the file date where a note has none. Where a note's text and its file time differ by a day (for example the 25 Oct review, file time 24 Oct), both are kept as written.
- No code, test, or tool file was changed by this pass.

## Folders that are not notes

- `docs/`: design and inventory files. Listed in the table below.
- `experiments/`: probe code, results, and short notes from 10 to 21 Oct. The Chrome profile copies (`.profile-*` folders) and the two probe `node_modules` folders were quarantined on 24 Oct; see [removed-2026-10-24.md](../historical/removed-2026-10-24.md).
- `tmp/`: keeps two tracked files. Its build logs and key dumps were quarantined on 24 Oct.
- `chrome/`, `firefox/`, `chrome-dev/`, `manifests/`: build output and manifests. Do not hand-edit. Regenerate with the build.
- `firefox.rebuild.*` and `firefox.stale.*` folders: build leftovers from April, quarantined on 24 Oct.
- `.claude/`: session and worktree data, about 1.2 GB (25 Oct review). Not a note.
- Root tool scripts: `chrome-config.cjs`, `firefox-config.cjs`, `chrome-launch.ps1`, `new-profile.ps1`, `webpack.mix.js`. Tooling, not notes.
- One root file has a mangled name (a private-use character in front of `cdp-dump-current.js`). Owner to rename or remove.

## Counts

- CURRENT: 17
- DEAD-END: 2
- HISTORICAL: 96
- NEAR: 2
- REFERENCE: 28
- ROADMAP: 33

## CURRENT

| Note | What it is, and what to do with it |
|---|---|
| [`AGENTS.md`](../AGENTS.md) | Repo rules: version-bump before any build, CDP only for live work, no Puppeteer, known architectural traps. Binding. |
| [`architecture.md`](../architecture.md) | Current architecture and constraints. Updated 24 Oct with a current state map, constraints and known tradeoffs. Older sections keep their dates. |
| [`planning.md`](../planning.md) | Front door: what is current, near, roadmap, historical and dead-ended, and which source wins when notes conflict. Rewritten 24 Oct. |
| [`docs/notes-register.md`](../docs/notes-register.md) | Register of every note with its status. Generated from the status table; update it when a note is added or changes status. |
| [`docs/dead-ends.md`](../docs/dead-ends.md) | Approaches tried and rejected, each with the reason and the source. Read before proposing a change in these areas. |
| [`dead-ends-review-2026-10-24.md`](../dead-ends-review-2026-10-24.md) | Owner decisions of 25 Oct (1 to 8) and the plan for the run-list excise, shadow checks and cleanup. Nothing from it is built yet. Appendix A proposes the consolidation; file moves need approval. |
| [`coder-instructions-2026-10-20.md`](../coder-instructions-2026-10-20.md) | Decisions 2 to 33 still bind (section 2). Work orders in section 0 are mostly done. Section 0a lists what still waits for the owner. |
| [`docs/queue-storage-layering.md`](../docs/queue-storage-layering.md) | Storage design: three layers, with the queue WAL as the authority. Phase boxes last checked 11 Oct; section 15 is the as-built record for 15 Oct. |
| [`entropy-reduction-action-plan-2026-09-09.md`](../entropy-reduction-action-plan-2026-09-09.md) | Reference list of recurring problems. AGENTS.md requires reading it before non-trivial sw.js changes. A checklist to apply, not a plan to execute. |
| [`events-to-flight-recorder-design.md`](../events-to-flight-recorder-design.md) | Built in v1.6.1442. Section 0 says what was built. Open choices B2 to B15 need an owner call. |
| [`progress-durability-design.md`](../progress-durability-design.md) | Progress lives in session memory only (decision 31, shipped in 1.6.1435). Its 19 Oct status says implemented in the working tree; that is now shipped. Open choices D3 to D9 remain. |
| [`legacy-index-cleanup-design.md`](../legacy-index-cleanup-design.md) | Startup removal of old index and progress copies (131 names, session marker). Coded and tested; the live check it needs is still pending. |
| [`normal-reconcile.txt`](../normal-reconcile.txt) | Reconcile-first direction and its guardrails (20 May). Folded into architecture.md under Scheduler / Reconciler; kept as the source for the guardrails. |
| [`readme.md`](../readme.md) | User-facing readme. Its status list (Firefox store still on 1.2, release tracks) was not re-verified in this pass. |
| [`User-Installation.md`](../User-Installation.md) | Install steps for users. Not re-verified in this pass. |
| [`historical/README.md`](../historical/README.md) | Index of the archive folder: what it holds, the rules for reading it, and the nine notes kept in the root. |
| [`tools/cdp/INVENTORY.md`](../tools/cdp/INVENTORY.md) | Forward-going CDP helpers, the reason each stays, and the 32 retired on 24 Oct (restore with git checkout). |

## NEAR

| Note | What it is, and what to do with it |
|---|---|
| [`space-page-redraw-plan-2026-10-24.md`](../space-page-redraw-plan-2026-10-24.md) | Four-stage plan for space-page redraws (24 Oct). Stage 1 is marked this build and may be in progress in another session. Owner to confirm. |
| [`handoff-2026-10-25.md`](../handoff-2026-10-25.md) | Latest handoff from the other session (written 24 Oct, dated 25 Oct): two commits, a save-check change waiting on the owner's commit decision, and version 1.6.1586. A point-in-time record; check git before acting on it. |

## ROADMAP

| Note | What it is, and what to do with it |
|---|---|
| [`completed-log-shards-plan-2026-10-25.md`](../completed-log-shards-plan-2026-10-25.md) | Deferred 24 Oct because performance is acceptable; captured as follow-up, not fixed. Agreed target: WAL-order (arrival) shards for locality and whole-shard pruning. The log is already in arrival order; checkpoints are still hash-split into 10 pieces. Engine step 1 and part of step 2 are in commit bfbcee5 and not enabled in the worker. Steps 4 to 7 not started. |
| [`unified-store-design.md`](../unified-store-design.md) | Design only. Its storage shape is superseded by the 25 Oct plan. Open behaviour choices A3 to A23 (dedupe window, requeue from history) are not settled by that plan. |
| [`pending-staging-design.md`](../pending-staging-design.md) | Design only. Pending records are still on disk (3,368 on the dev profile, 18 Oct). Open choices C2 to C15; C10 (the 18 empty records) is an owner question. |
| [`projection-cost-design-note-2026-10-18.md`](../projection-cost-design-note-2026-10-18.md) | Open: whether finished rows belong in the content index, and what it costs after a live run. |
| [`pause-owned-tab-order-options-2026-10-18.md`](../pause-owned-tab-order-options-2026-10-18.md) | Owner decision open: close owned tabs before or after the paused rows are saved. The single-shape part is done (pause flag set first). |
| [`window-slot-release-options-2026-10-17.md`](../window-slot-release-options-2026-10-17.md) | Owner decision open: when a blocked tab may close. Evidence from one five-minute run. No code changed. |
| [`user-note.md`](../user-note.md) | Intent: profile search stays usable while work for the same search is pending. Parked UI item, not started. Dated sections; the newest wins. |
| [`docs/preload-next-tab.md`](../docs/preload-next-tab.md) | Planning only. Phase 0 measurements not taken. The 24 Oct update shows handoff at 0.37 s, which weakens the case. Decide with measurements. |
| [`mutated-running-total-audit-todo-2026-09-25.md`](../mutated-running-total-audit-todo-2026-09-25.md) | Audit to-do for running totals recomputed and written back (25 Sep). Runs have since moved to the log; the audit is not recorded as done. |
| [`housekeeping.md`](../housekeeping.md) | Wish list for splitting sw.js (27 Jun). Storage, dashboard and preferences modules exist. The rest is not scheduled. |
| [`atproto-discussion-research-note.md`](../atproto-discussion-research-note.md) | External research context on atproto. No decision. |
| [`atproto-moderation-model.md`](../atproto-moderation-model.md) | Design context for a future publication model on atproto. Not planned for the current line. |
| [`blockzooka-synergy-2026-10-12.md`](../blockzooka-synergy-2026-10-12.md) | Design context and cautions for working with Blockzooka. Not an active runtime plan. |
| [`labeler-management-note.md`](../labeler-management-note.md) | Future operations design for labelers (20 May). No decision. |
| [`quora-labeler-bridge.md`](../quora-labeler-bridge.md) | Design for a future labeler bridge. No decision. |
| [`nuclear-source-enrollment-note.md`](../nuclear-source-enrollment-note.md) | Future space-classification and nuke workflow. Not proposed for immediate work. |
| [`mute-block-ios-safari-plan.md`](../mute-block-ios-safari-plan.md) | Future iPhone Safari plan, separate from the desktop queue. First version limited to foreground, user-directed actions. |
| [`shared-moderation-design-mb-development-post-2026-05-18.txt`](../shared-moderation-design-mb-development-post-2026-05-18.txt) | Discussion draft on the shared-moderation buttons (20 May). Not a plan. |
| [`shared-moderation-publication-design-2026-05-18.md`](../shared-moderation-publication-design-2026-05-18.md) | Core design of shared-moderation publication (18 May). Runtime integration deferred. The pure module exists and no runtime file imports it. |
| [`shared-moderation-publication-implementation-plan-2026-05-18.md`](../shared-moderation-publication-implementation-plan-2026-05-18.md) | Implementation plan (18 May). Runtime integration deferred until queue authority is stable. |
| [`shared-moderation-integration-steps-2026-05-19.md`](../shared-moderation-integration-steps-2026-05-19.md) | Staged integration steps (19 May). Runtime integration deferred. |
| [`shared-moderation-runtime-boundary-handoff-2026-05-20.md`](../shared-moderation-runtime-boundary-handoff-2026-05-20.md) | Boundary handoff (20 May). The rule that moderation data is advisory, not a command channel, is in architecture.md. |
| [`shared-moderation-test-plan-2026-05-20.md`](../shared-moderation-test-plan-2026-05-20.md) | Pure-model and mock test plan (20 May). The safe lane today. |
| [`shared-moderation-live-operation-test-outline-2026-05-20.md`](../shared-moderation-live-operation-test-outline-2026-05-20.md) | Future live-test outline. Not current. |
| [`shared-moderation-live-quora-test-plan-2026-05-20.md`](../shared-moderation-live-quora-test-plan-2026-05-20.md) | Future live Quora test plan. Not current. |
| [`shared-moderation-review-2026-10-25.md`](../shared-moderation-review-2026-10-25.md) | Review of the May shared-moderation notes against the code and owner decisions (25 Oct). Lists the decisions needed before any runtime build. |
| [`blockzooka-red-list-mapping-2026-10-25.md`](../blockzooka-red-list-mapping-2026-10-25.md) | Blockzooka red list mapped to our reason names (25 Oct). Owner decides each row. Exact names still need the raw file. |
| [`firefox-mock-harness-integration-plan-2026-05-19.md`](../firefox-mock-harness-integration-plan-2026-05-19.md) | Mock Quora and Firefox harness plan (19 May). The harness exists under tools/; the plan's remaining items are not verified. |
| [`regression-test-suite-ideas-2026-05-18.md`](../regression-test-suite-ideas-2026-05-18.md) | Layered test strategy and ideas (18 May). Partly in use; not scheduled. |
| [`more-fuzz-tests.md`](../more-fuzz-tests.md) | Test plans for more fuzzers (24 May). Not scheduled. |
| [`upgrade-regression-plan.md`](../upgrade-regression-plan.md) | Browser upgrade regression plan (10 Jun). The regression tool exists; no live run is recorded in the plan. |
| [`release-summary-1.6-aka-2.0.md`](../release-summary-1.6-aka-2.0.md) | Draft public release narrative for 2.0, based on 1.6.246. Not an engineering plan. |
| [`docs/flight-recorder-display-plan-2026-10-24.md`](../docs/flight-recorder-display-plan-2026-10-24.md) | Plan for the flight recorder display, for discussion. The intent is not settled: decisions D0 to D8 are open, and nothing has been edited. |
| [`docs/outliers-plan-2026-10-24.md`](../docs/outliers-plan-2026-10-24.md) | Plan for the outlier recording limit (3.5 seconds or more, future recordings only, on top of the old rules) and the recorder events kept with each kept outlier. Decisions made, several tentatively worded; the events persist with their outlier until Clear. Open: whether 3.5 seconds is fixed or scales, and whether later events are added. Not built. |

## DEAD-END

| Note | What it is, and what to do with it |
|---|---|
| [`direct-api-used.md`](../direct-api-used.md) | Direct Quora API research, parked. Mutations (block, mute) through the private endpoint were declined because they bypass the anti-bot token check. Reads parked. |
| [`experiments/quora-direct-api/README.md`](../experiments/quora-direct-api/README.md) | Direct API extraction experiments. Mutations declined; reads parked. Same decision as direct-api-used.md. |

## HISTORICAL

| Note | What it is, and what to do with it |
|---|---|
| [`historical/unified-store-build-plan-2026-10-20.md`](../historical/unified-store-build-plan-2026-10-20.md) | Shipped in 1.6.1437: nuked and pending maps stored as 32 buckets each. The rest of the unified store is superseded by the 25 Oct plan. |
| [`historical/blockzooka-reply-draft-2026-10-14.md`](../historical/blockzooka-reply-draft-2026-10-14.md) | Unsent draft reply to the Blockzooka author (14 Oct). Not sent. |
| [`historical/parallel-test-split-plan.md`](../historical/parallel-test-split-plan.md) | Test split plan (7 Jun). The parallel runner exists with 52 lanes; the lane list is not re-checked. |
| [`historical/entropy-audit-phase1-subplan-2026-09-09.md`](../historical/entropy-audit-phase1-subplan-2026-09-09.md) | Phase 1 audit sub-plan under the entropy catalogue (9 Sep). Superseded as a plan; the catalogue is the reference. |
| [`historical/LEGACY_QUEUE_VIEW_RETIREMENT.md`](../historical/LEGACY_QUEUE_VIEW_RETIREMENT.md) | Retirement record for the legacy queue view (9 Oct). Its startup cleanup is in the code since the 20 Oct legacy cleanup. |
| [`historical/legacy-progress-repair-tombstone-2026-06-01.md`](../historical/legacy-progress-repair-tombstone-2026-06-01.md) | Tombstone for old progress and repair names, kept on purpose. Not a live API. |
| [`historical/sw-state-machine-decomposition-plan-2026-09-01.md`](../historical/sw-state-machine-decomposition-plan-2026-09-01.md) | Plan to split sw.js (1 Sep). Part 1 done. Redirected on 17 Sep to the single decision core in architecture.md. |
| [`historical/flight-recorder-plan-2026-06-04.md`](../historical/flight-recorder-plan-2026-06-04.md) | Plan for the flight recorder (4 Jun). Shipped; see events-to-flight-recorder-design.md and architecture.md. |
| [`historical/storage-wal-overlay-design-2026-05-20.md`](../historical/storage-wal-overlay-design-2026-05-20.md) | WAL and checkpoint design (20 May, updated 27 May). The lineage of the current engine. Its plans are superseded by queue-storage-layering.md and the 25 Oct plan. |
| [`historical/storage-authority-refactor-plan-for-review-2026-05-20.md`](../historical/storage-authority-refactor-plan-for-review-2026-05-20.md) | Storage authority plan (20 May). Superseded by docs/queue-storage-layering.md. |
| [`historical/storage-observability-baseline-2026-05-22.md`](../historical/storage-observability-baseline-2026-05-22.md) | Storage observability baseline (22 May). Snapshot. |
| [`historical/storage-refactor-start-checkpoint-2026-05-20.md`](../historical/storage-refactor-start-checkpoint-2026-05-20.md) | Start checkpoint of the storage refactor (20 May). Snapshot. |
| [`historical/storage-row-event-baseline-1.6.487-2026-05-23.md`](../historical/storage-row-event-baseline-1.6.487-2026-05-23.md) | Row-event baseline at 1.6.487 (23 May). Snapshot. |
| [`historical/queue-wal-segmented-record-followup-2026-05-27.md`](../historical/queue-wal-segmented-record-followup-2026-05-27.md) | Follow-up on segmented queue WAL records (27 May). Segmented storage has landed; see architecture.md. |
| [`historical/wal-overnight-slice-notes-2026-05-25.md`](../historical/wal-overnight-slice-notes-2026-05-25.md) | Slice log for the WAL migration (25 to 28 May, 115 KB). Paused after slice 17 and superseded. |
| [`historical/batching-metrics.md`](../historical/batching-metrics.md) | Storage batching metrics model (20 May). Superseded by the flight recorder and the storage counters. |
| [`historical/reconciler-first-fallback-architecture-2026-05-20.md`](../historical/reconciler-first-fallback-architecture-2026-05-20.md) | Rationale and pivot criteria for the reconciler (20 May). architecture.md is the current statement. |
| [`historical/coordinator-page-refactor-plan-2026-05-08.md`](../historical/coordinator-page-refactor-plan-2026-05-08.md) | Coordinator page split plan (8 May). Mostly absorbed by the 1.6 scheduler and dashboard work. |
| [`historical/top-level-rethink-1.5.md`](../historical/top-level-rethink-1.5.md) | Design history of the durable job model (20 May). Provenance only. |
| [`historical/top-level-rethink-1.5-execution-plan.md`](../historical/top-level-rethink-1.5-execution-plan.md) | Checklist for the 1.6 reset (24 May). Provenance only; current status must be rechecked. |
| [`historical/refactor-1.5-plan.md`](../historical/refactor-1.5-plan.md) | Closed plan for the 1.5 series. |
| [`historical/refactor-1.6-plan.md`](../historical/refactor-1.6-plan.md) | Prior canonical plan for the 1.6 line. Superseded by planning.md; kept as detail. |
| [`historical/refactor-1.6-handoff-2026-05-14.md`](../historical/refactor-1.6-handoff-2026-05-14.md) | Handoff (14 May). Superseded for current priorities. |
| [`historical/refactor-1.6-handoff-2026-05-17.md`](../historical/refactor-1.6-handoff-2026-05-17.md) | Handoff (17 May). Superseded for current priorities. |
| [`historical/refactor-redux-precheck-2026-06-24.md`](../historical/refactor-redux-precheck-2026-06-24.md) | Precheck for the refactor branch (24 Jun, updated 1 Jul). Snapshot. |
| [`historical/retrospective-history.md`](../historical/retrospective-history.md) | Narrative history of the 1.x to 1.6 series (24 May). Use for context only. |
| [`historical/notes-1.5`](../historical/notes-1.5) | Notes from the 1.5 series (10 May). |
| [`historical/todo-1.5`](../historical/todo-1.5) | Closed 1.5 to-do note. |
| [`historical/review-1.md`](../historical/review-1.md) | Review note (30 Jun). |
| [`historical/review-findings.md`](../historical/review-findings.md) | Review findings (24 May). Themes folded into the canonical notes. |
| [`historical/review-findings-cruft-cleanup-2026-05-17.md`](../historical/review-findings-cruft-cleanup-2026-05-17.md) | Cruft review (17 May). Partly obsolete. |
| [`historical/review-findings-resolver-queue-2026-05-17.md`](../historical/review-findings-resolver-queue-2026-05-17.md) | Resolver queue review (17 May). Resolved. |
| [`historical/review-executor-tab-lifecycle-2026-05-19.md`](../historical/review-executor-tab-lifecycle-2026-05-19.md) | Executor and tab lifecycle review (19 May). Resolved. |
| [`historical/review-pause-resume-cancel-ordering-2026-05-19.md`](../historical/review-pause-resume-cancel-ordering-2026-05-19.md) | Pause, resume and cancel ordering review (19 May). Resolved. |
| [`historical/review-progress-vs-queue-authority-2026-05-19.md`](../historical/review-progress-vs-queue-authority-2026-05-19.md) | Progress against queue authority review (19 May). Progress now lives in session memory (decision 31). |
| [`historical/review-recovery-resume-triggers-2026-05-19.md`](../historical/review-recovery-resume-triggers-2026-05-19.md) | Recovery and resume triggers review (19 May). Resolved. |
| [`historical/review-recovery.md`](../historical/review-recovery.md) | Early recovery sketch (20 May). Superseded. |
| [`historical/review-storage-serialization-boundaries-2026-05-19.md`](../historical/review-storage-serialization-boundaries-2026-05-19.md) | Serialization boundaries review (19 May). Resolved. |
| [`historical/review-fix-checklist-2026-05-20.md`](../historical/review-fix-checklist-2026-05-20.md) | Checklist of the May review fixes. Complete. |
| [`historical/14-oct-review-1.md`](../historical/14-oct-review-1.md) | De novo review of shared/ (14 Oct, review 1). Findings answered in the reply; closed items are listed in planning.md. |
| [`historical/14-oct-review-2.md`](../historical/14-oct-review-2.md) | Deeper review of sw.js and content.js (14 Oct, review 2). Owner accepted the suggestions; status per item is in the reply. |
| [`historical/14-oct-review-2-reply.md`](../historical/14-oct-review-2-reply.md) | Reply to review 2 (14 Oct). Section 8 holds each item's status. |
| [`historical/14-oct-review-2-response.md`](../historical/14-oct-review-2-response.md) | Reviewer response to the review 2 reply (14 Oct). |
| [`historical/14-oct-review-2-response-2.md`](../historical/14-oct-review-2-response-2.md) | Reviewer response, second round (14 Oct). |
| [`historical/14-oct-review-2-response-3.md`](../historical/14-oct-review-2-response-3.md) | Reviewer reply, third round (15 Oct). |
| [`historical/14-oct-review-3.md`](../historical/14-oct-review-3.md) | De novo review 3 (14 Oct). Its identity findings were built. Sender-role choice R3-3 is still open in planning.md. |
| [`historical/14-oct-review-3-reply.md`](../historical/14-oct-review-3-reply.md) | Reply to review 3 (15 Oct). Sections 7 to 10 are the as-built identity and landing record. R3-3 and R3-6 stay open. |
| [`historical/14-oct-review-4.md`](../historical/14-oct-review-4.md) | De novo review 4 (15 Oct), readiness for a live run. Open items are carried in planning.md. |
| [`historical/14-oct-review-5.md`](../historical/14-oct-review-5.md) | De novo review 5 (15 Oct), readiness for a live run. Answered by the two response files. |
| [`historical/14-oct-review-5-response.md`](../historical/14-oct-review-5-response.md) | Reviewer response to the review 5 check (15 Oct). |
| [`historical/14-oct-review-5-response-2.md`](../historical/14-oct-review-5-response-2.md) | Reviewer response, round 2 (15 Oct). Archive rule for non-retryable rows. The dry-run item R5-2 is open. |
| [`historical/codex-review-8-oct.md`](../historical/codex-review-8-oct.md) | Codex review of 8 Oct, the first of the series. Superseded by the later takes. |
| [`historical/codex-review-8-oct-take-2.md`](../historical/codex-review-8-oct-take-2.md) | Codex review take 2 (9 Oct). Superseded. |
| [`historical/codex-review-8-oct-take-3.md`](../historical/codex-review-8-oct-take-3.md) | Codex review take 3 (9 Oct). Superseded. |
| [`historical/codex-review-8-oct-take-4.md`](../historical/codex-review-8-oct-take-4.md) | Codex review take 4 (9 Oct). Superseded. |
| [`historical/codex-review-8-oct-take-5.md`](../historical/codex-review-8-oct-take-5.md) | Codex review take 5 (9 Oct). Superseded. |
| [`historical/codex-review-8-oct-take-6.md`](../historical/codex-review-8-oct-take-6.md) | Codex review take 6 (9 Oct). Superseded. |
| [`historical/codex-review-8-oct-take-7.md`](../historical/codex-review-8-oct-take-7.md) | Codex architecture review take 7 (11 Oct). Superseded. |
| [`historical/codex-review-8-oct-take-8.md`](../historical/codex-review-8-oct-take-8.md) | Codex architecture review take 8 (12 Oct). Superseded. |
| [`historical/codex-review-9-oct-take-3.md`](../historical/codex-review-9-oct-take-3.md) | Codex review of live epoch observations (9 Oct). Superseded. |
| [`historical/codex-review-10-oct-take-4.md`](../historical/codex-review-10-oct-take-4.md) | Codex JavaScript review, take 4 (10 Oct). Superseded; its findings are in the review work queue. |
| [`historical/clear-history-2026-10-18.md`](../historical/clear-history-2026-10-18.md) | Record of finished items and dead ends, with the retired coder instructions and release notes to 1.6.1436. Kept so they are not reworked. Dead ends are indexed in docs/dead-ends.md. |
| [`historical/coder-instructions-2026-10-18.md`](../historical/coder-instructions-2026-10-18.md) | Retired stub. Full text is in historical/clear-history-2026-10-18.md, section 11. |
| [`historical/hunk-map-2026-10-18.md`](../historical/hunk-map-2026-10-18.md) | Hunk map of the 18 Oct working tree. Superseded by the commits from 8b245a1 to bfbcee5. |
| [`historical/progress-path-review-2026-10-18.md`](../historical/progress-path-review-2026-10-18.md) | Review of progress write paths (18 Oct). Superseded by decisions 27 to 32 (progress in session memory). |
| [`historical/suffix-cutting-discussion-2026-10-14.md`](../historical/suffix-cutting-discussion-2026-10-14.md) | Findings behind the identity rule (14 to 15 Oct). The rule itself is in architecture.md. |
| [`historical/cesc-fabregas-orphaned-tabs-bug-2026-09-19.md`](../historical/cesc-fabregas-orphaned-tabs-bug-2026-09-19.md) | Bug record (19 Sep): orphaned executor tabs with no durable record. Later orphan fixes shipped (1.6.1441). The original report was not re-checked live. |
| [`historical/fight-to-flight.md`](../historical/fight-to-flight.md) | Debugging log of the last five commits (17 to 29 Sep). |
| [`historical/live-batch-fixes-worklist-2026-09-19.md`](../historical/live-batch-fixes-worklist-2026-09-19.md) | Worklist from the 19 Sep live batch. Fixes shipped in e2e5c65. Open items were not carried forward. |
| [`historical/live-testing-todo-2026-09-08.md`](../historical/live-testing-todo-2026-09-08.md) | Live testing to-do list (8 Sep). Open items were not carried forward. |
| [`historical/live-testing-todo-2026-09-14.md`](../historical/live-testing-todo-2026-09-14.md) | Live testing findings (14 Sep, overnight). Open items were not carried forward. |
| [`historical/handoff-2026-09-08-decomposition-and-live-test.md`](../historical/handoff-2026-09-08-decomposition-and-live-test.md) | Handoff (8 Sep). Point in time. |
| [`historical/handoff-2026-09-19.md`](../historical/handoff-2026-09-19.md) | Handoff (19 Sep). Live batch fixes; point in time. |
| [`historical/handoff-2026-09-20.md`](../historical/handoff-2026-09-20.md) | Handoff (20 Sep). Queue-scan root cause; point in time. |
| [`historical/handoff-2026-10-08.md`](../historical/handoff-2026-10-08.md) | Handoff (8 Oct). Handoff latency work, 1.6.1377 to 1.6.1383; point in time. |
| [`historical/handoff-queue-validation-2026-06-17.md`](../historical/handoff-queue-validation-2026-06-17.md) | Handoff (17 Jun). Point in time. |
| [`historical/handoff-queue-validation-2026-06-17-coordinator.md`](../historical/handoff-queue-validation-2026-06-17-coordinator.md) | Coordinator handoff (17 Jun). Point in time. |
| [`historical/handoff-storage-authority-refactor-2026-05-20.md`](../historical/handoff-storage-authority-refactor-2026-05-20.md) | Handoff (20 May). Point in time. |
| [`historical/other-codex-ordered-handoff-2026-05-19.md`](../historical/other-codex-ordered-handoff-2026-05-19.md) | Ordered handoff (19 May). Snapshot. |
| [`historical/space-nuke-handoff-2026-05-03.md`](../historical/space-nuke-handoff-2026-05-03.md) | Handoff (3 May). Older 1.4 context. |
| [`historical/space-nuke-bidi-debugging-2026-05-07.md`](../historical/space-nuke-bidi-debugging-2026-05-07.md) | Live debugging log for the Firefox BiDi setup (7 May, 104 KB). Setup context only. |
| [`historical/codebase-familiarization-notes-2026-08-28.md`](../historical/codebase-familiarization-notes-2026-08-28.md) | Orientation notes on queue states (28 Aug). Partly out of date; use architecture.md. |
| [`historical/claude-notes.md`](../historical/claude-notes.md) | Working notes (25 Aug). Live findings belong in the current notes, not in these. |
| [`historical/consul-investigation-session.md`](../historical/consul-investigation-session.md) | Session transcript (24 Apr). Not part of the current line. |
| [`historical/de-novo-product-and-harness-review-2026-06-12.md`](../historical/de-novo-product-and-harness-review-2026-06-12.md) | Product and harness review at 1.6.955 (12 Jun). A snapshot. |
| [`historical/observations-554.txt`](../historical/observations-554.txt) | Dashboard observations (28 May). |
| [`historical/progress.txt`](../historical/progress.txt) | Scratch notes (27 May). |
| [`historical/recovery-is-normal-data.txt`](../historical/recovery-is-normal-data.txt) | Scratch note on metrics interpretation (20 May). |
| [`historical/sunday-notes.md`](../historical/sunday-notes.md) | Scratch notes (20 May). |
| [`historical/nits.txt`](../historical/nits.txt) | Checklist of 16 Sep with shipped and open items. Open items were not carried forward. |
| [`historical/nits2.md`](../historical/nits2.md) | Checklist (27 Sep). Items marked done. |
| [`historical/nits3.md`](../historical/nits3.md) | Checklist (29 Sep). One item open: the worker-window button when a window is already open. |
| [`historical/nits4.md`](../historical/nits4.md) | Short checklist (29 Sep). |
| [`historical/nits5.md`](../historical/nits5.md) | Short checklist (30 Sep). |
| [`historical/nits6.md`](../historical/nits6.md) | Short checklist (3 Oct). |
| [`historical/removed-2026-10-24.md`](../historical/removed-2026-10-24.md) | Record of what was removed on 24 Oct, and how to restore it. |

## REFERENCE

| Note | What it is, and what to do with it |
|---|---|
| [`blockzooka-writeup.md`](../blockzooka-writeup.md) | External write-up on Blockzooka (20 May). Reference only. |
| [`blockzooka-red-list-bloom-2026-10-14.md`](../blockzooka-red-list-bloom-2026-10-14.md) | Captured note from the Blockzooka author (14 Oct) on a red-list Bloom filter. Confirm any hit against the authoritative list. |
| [`storage-authority-callsite-inventory-2026-05-20.md`](../storage-authority-callsite-inventory-2026-05-20.md) | Storage call-site inventory, updated 7 Oct. Dated; re-run before relying on it. |
| [`queue-wakeup-metrics-model-2026-05-20.md`](../queue-wakeup-metrics-model-2026-05-20.md) | Queue wake-up metrics model (20 May). Counter names need a refresh. |
| [`queue-wakeup-analysis-playbook-2026-05-20.md`](../queue-wakeup-analysis-playbook-2026-05-20.md) | Playbook for reading the wake-up metrics (20 May). Counter names need a refresh. |
| [`timeout-inventory-1.6.md`](../timeout-inventory-1.6.md) | Timeout inventory (20 May). Stale; refresh after the timeouts registry merge. |
| [`docs/queue-storage-inventory-2026-10-11.md`](../docs/queue-storage-inventory-2026-10-11.md) | Generated inventory of storage call sites (11 Oct). Regenerate with tools/inventory-queue-storage.js before relying on its numbers. |
| [`magic-number-audit-2026-10-25.tsv`](../magic-number-audit-2026-10-25.tsv) | Generated audit of numeric literals (2,073 rows). Feeds the constants rule in the 25 Oct review. |
| [`sw-decomposition-inventory-2026-09-01.tsv`](../sw-decomposition-inventory-2026-09-01.tsv) | Inventory of sw.js functions (5 Sep). Dated; regenerate before use. |
| [`experiments/findings-2026-10-21.md`](../experiments/findings-2026-10-21.md) | Research record (20 to 21 Oct). Nothing in it is a decision. Includes a timer finding: a service-worker timer did not survive 35 minutes. |
| [`experiments/design-probes/NOTE.md`](../experiments/design-probes/NOTE.md) | Probe record (12 Oct): routing, startup handoff, atomicity, owner lifetime, tab API. One run per probe, one storage context. |
| [`experiments/design/NOTE.md`](../experiments/design/NOTE.md) | Decision input (12 Oct) on queue writer and storage mediation over the existing backend. A hypothesis, not a decision. |
| [`experiments/existing-wal/NOTE.md`](../experiments/existing-wal/NOTE.md) | Sizing of the existing storage and WAL at a 1,000-row queue (12 Oct). Planning input. |
| [`experiments/firefox-validation/NOTE.md`](../experiments/firefox-validation/NOTE.md) | Firefox probe (12 Oct): worker, election and broadcast. One run. Planning input. |
| [`experiments/foreground-worker/NOTE.md`](../experiments/foreground-worker/NOTE.md) | Origin probe (11 Oct) for the foreground worker design. Planning input. |
| [`experiments/indexeddb/NOTE.md`](../experiments/indexeddb/NOTE.md) | IndexedDB spike (11 Oct). Planning input. Nothing adopted, and no work done on it (owner, 24 Oct). |
| [`experiments/mirror-broadcast/NOTE.md`](../experiments/mirror-broadcast/NOTE.md) | Probe (12 Oct): can an owner page publish mirror updates on a broadcast channel. Planning input. |
| [`experiments/mock-owner/NOTE.md`](../experiments/mock-owner/NOTE.md) | Mock model (12 Oct) of publication cost and the owner protocol. Mocks only. |
| [`experiments/owner-election/NOTE.md`](../experiments/owner-election/NOTE.md) | Probe (11 Oct): owner election across extension pages with Web Locks. Planning input. |
| [`experiments/page-throttle/NOTE.md`](../experiments/page-throttle/NOTE.md) | Probe (11 Oct): foreground versus background page throttling. Planning input. |
| [`experiments/progress-split/NOTE.md`](../experiments/progress-split/NOTE.md) | Probe (12 Oct): storage on the page, CPU in a worker, relay from the service worker. Planning input. |
| [`experiments/sqlite/NOTE.md`](../experiments/sqlite/NOTE.md) | SQLite options (11 Oct). Planning input. Nothing adopted, and no work done on it (owner, 24 Oct). |
| [`tools/cdp/README.md`](../tools/cdp/README.md) | CDP helper dictionary. Check it against the current tools before use. |
| [`tools/firefox-bidi/README.md`](../tools/firefox-bidi/README.md) | Firefox BiDi harness readme. |
| [`tools/mock-quora/README.md`](../tools/mock-quora/README.md) | Mock Quora fixtures readme. |
| [`test/fixtures/raw-report-pages/README.md`](../test/fixtures/raw-report-pages/README.md) | Fixture notes for raw report pages. |
| [`test/fixtures/shared-moderation/README.md`](../test/fixtures/shared-moderation/README.md) | Fixture notes for shared moderation. |
| [`mix-manifest.json`](../mix-manifest.json) | Generated by the build (npx mix --production). Keep; it is not junk. |

## SCRATCH

| Item | Note |
|---|---|

