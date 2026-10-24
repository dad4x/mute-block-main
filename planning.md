# Mute Block Planning

Date: 2026-10-15. The priority order and the work lanes below date from
2026-05-20 and were not revised in this update. The as-built state is in
"Where We Have Landed" and the open items are in "Loose Ends".

This is the canonical planning front door for the current `main` line. Use this
file first, then follow the linked notes only for detail.

The active development line is private `1.6` stabilization for the public `2.0`
release. The older `1.5` notes are design history and slice detail, not the
place to start new work.

## Where We Have Landed (as built, 15 Oct 2026)

The state of the working tree on `review/shared-wip` (HEAD `abc2307`). The
changes are uncommitted and are not released. The version and build are set at
build time and are not recorded here. The last full `npm test` run in the 14 and
15 Oct review cycle reported 1,175 `ok` and 0 `not ok`.

Landed in the 14 and 15 Oct review cycle. The detail is in the replies,
[14-oct-review-2-reply.md](14-oct-review-2-reply.md) and
[14-oct-review-3-reply.md](14-oct-review-3-reply.md), and in
[architecture.md](architecture.md), "Profile Identity, Landing And Resolution":

- **Profile identity is exact.** The slug is case-sensitive, NFC, with no suffix
  cut, no trims, and the query and fragment dropped. The truncation filter, the
  lower-cased identity key and the name-association candidate are removed.
- **Landing check.** The queued href and the landed URL are compared exactly
  after normalisation. The worker's check is skipped for resolver rows.
- **Retry.** A row with its own link is never retried as a resolution from its
  post. A "did not land" row is not retried. It is terminal and archivable.
- **Resolver counters and card.** Each resolver choice is counted, and the
  dashboard's Metrics section has a Live checks card. Its alert is the scored-scan
  count above zero.
- **Stored-work clear.** The re-read is bounded (2). The last pass removes rows
  that moved, and their tabs are closed.
- **Settings.** A value of the wrong type is rejected and reported
  (`setExtensionSettingsRequested` returns `rejected`). The preferences page
  says which settings were not saved.
- **Dashboard.** One run-status timer, started and stopped by
  `syncDebugRunStatusTimer`.
- **Executor and pause (review 2).** The executor start token, the supersession
  counters, the fill token, the pause generation guard, the settlement lock,
  sender precedence, and scoped global progress writes.
- **Diagnostics.** The claim-retry hit diagnostic, the unhandled-message
  diagnostic, and the fill-iteration failure record.

Designed, not built: the dry-run mode. It reads the landed page and records a
verdict without a click. Its first step is a trace of every path that starts a
tab from `claimPendingTabAction`.

## Current Priority Order

1. Stabilize queue execution and recovery.
   The live-debug line is still finding scheduler/storage edge cases. Do not add
   new runtime entry points until queue authority is boring.

2. Converge on the normal reconciler model.
   The active design direction is that durable queue state plus live browser
   observations are reconciled by a bounded scheduler tick. Direct operate paths
   may request ticks, but they should not be a competing authority.

3. Finish storage authority cleanup before WAL integration.
   Reduce scattered full-state load/save call sites, quarantine compatibility
   writers, and keep write reasons visible before making WAL the normal
   durability layer.

4. Expand deterministic tests around the scheduler/storage invariants.
   Live Quora testing remains useful evidence, but regression protection should
   live in synthetic state-machine, storage, fixture, and mock-browser tests
   whenever possible.

5. Resume shared moderation integration after queue/runtime stabilization.
   The pure model, fixtures, and mock harness can continue safely. Runtime
   integration must remain local-policy-first and must not become a remote
   command channel.

## Active Work Lanes

### Queue And Scheduler

Status: active and volatile.

Canonical architecture: [architecture.md](architecture.md).

Supporting notes:

- [normal-reconcile.txt](normal-reconcile.txt): most recent statement of the
  "repair is normal processing" direction and implementation guardrails.
- [reconciler-first-fallback-architecture-2026-05-20.md](reconciler-first-fallback-architecture-2026-05-20.md):
  design rationale and pivot criteria.
- [queue-wakeup-metrics-model-2026-05-20.md](queue-wakeup-metrics-model-2026-05-20.md)
  and [queue-wakeup-analysis-playbook-2026-05-20.md](queue-wakeup-analysis-playbook-2026-05-20.md):
  metrics model for deciding whether pumps, nudges, and repair are healthy.
- [timeout-inventory-1.6.md](timeout-inventory-1.6.md): current timeout
  inventory, useful for auditing scheduler deadlines.

Deferred cleanup reminder:

- Once queue execution is stable and reliable, re-check whether the background
  page / background executor surface is still necessary. If the reconciler and
  WAL-backed scheduler can run reliably without it, remove that extra browser
  surface rather than carrying it as permanent architecture.

Parked UI item (not started):

- Profile search toolbar must stay usable while queued work for the same search
  is still running. `Collect 100 More` stays enabled, and progress shows as a
  separate status. Intent and rationale: [user-note.md](user-note.md), section
  "Profile Search While Work Is Pending". Implementation touches
  `syncProfileSearchControls` in `shared/js/content.js` and the matching
  assertions in `test/p1-contract.test.js`.

### Storage Authority And WAL

Status: active design and refactor lane.

Supporting notes:

- [storage-authority-refactor-plan-for-review-2026-05-20.md](storage-authority-refactor-plan-for-review-2026-05-20.md):
  current storage authority cleanup plan.
- [storage-authority-callsite-inventory-2026-05-20.md](storage-authority-callsite-inventory-2026-05-20.md):
  call-site inventory for storage authority review.
- [storage-wal-overlay-design-2026-05-20.md](storage-wal-overlay-design-2026-05-20.md):
  target WAL/A-B checkpoint/gzip design.
- [batching-metrics.md](batching-metrics.md): metrics to tell whether batching
  reduced full writes or only delayed them.
- [handoff-storage-authority-refactor-2026-05-20.md](handoff-storage-authority-refactor-2026-05-20.md):
  point-in-time handoff, not the canonical plan.

### Tests And Harnesses

Status: active support lane.

Supporting notes:

- [regression-test-suite-ideas-2026-05-18.md](regression-test-suite-ideas-2026-05-18.md):
  layered test strategy.
- [firefox-mock-harness-integration-plan-2026-05-19.md](firefox-mock-harness-integration-plan-2026-05-19.md):
  mock Quora/Firefox harness integration.
- [shared-moderation-test-plan-2026-05-20.md](shared-moderation-test-plan-2026-05-20.md):
  shared moderation pure/model and future runtime tests.
- [shared-moderation-live-operation-test-outline-2026-05-20.md](shared-moderation-live-operation-test-outline-2026-05-20.md)
  and [shared-moderation-live-quora-test-plan-2026-05-20.md](shared-moderation-live-quora-test-plan-2026-05-20.md):
  future live shared-moderation gates.

### Shared Moderation

Status: pure/model and planning lane; runtime integration deferred until queue
authority stabilizes.

Supporting notes:

- [shared-moderation-publication-design-2026-05-18.md](shared-moderation-publication-design-2026-05-18.md):
  core design.
- [shared-moderation-publication-implementation-plan-2026-05-18.md](shared-moderation-publication-implementation-plan-2026-05-18.md):
  implementation plan for Quora shared posts.
- [shared-moderation-integration-steps-2026-05-19.md](shared-moderation-integration-steps-2026-05-19.md):
  staged integration steps.
- [shared-moderation-runtime-boundary-handoff-2026-05-20.md](shared-moderation-runtime-boundary-handoff-2026-05-20.md):
  runtime boundary handoff.
- [quora-labeler-bridge.md](quora-labeler-bridge.md),
  [atproto-moderation-model.md](atproto-moderation-model.md), and
  [labeler-management-note.md](labeler-management-note.md): future publication
  architecture context.

## To-Do Queue (after the 14 Oct review cycle)

Owner direction, 2026-10-14, to start once the 14 Oct review cycle was complete:
[14-oct-review-2-reply.md](14-oct-review-2-reply.md). The cycle is closed for the
items in "Where We Have Landed". Its open items are in "Loose Ends". Status
on each item is as of 15 Oct.

1. Symbolic timeout registry, first pass landed. Move every timeout, threshold and
   scheduling-delay literal on the queue and content paths into one registry,
   alongside the others. That covers the executor-start latch thresholds
   (250 ms and 1.5 s), the stale-promise constants, the create and fill
   timeouts with their `* 2` and `* 6` multipliers, the literal delays in
   `sw.js`, and the waits in `content.js`. Values stay as they are in that
   pass; the owner has no view on values yet. Decide the one home first:
   `shared/js/timeouts.js` and `shared/js/tunables.js` both hold timeouts
   today. Start from [timeout-inventory-1.6.md](timeout-inventory-1.6.md).
   Status, 15 Oct: the first pass is `shared/js/timeouts.js`, which holds the
   default values of each wait-loop function. The explicit per-call overrides in
   `content.js` are still literals, to be migrated as each is touched. Value
   decisions wait for hit counts (item 2).
2. Hit counts. Count how often each named timeout or threshold fires, using the
   existing queue wakeup metrics. Include the content-side observer debounces.
   This comes before item 1's value decisions, so the values can be chosen from
   data.
   Status, 15 Oct: partly done. The resolver and landing counters, the
   suffix-shadow counter and the claim-retry diagnostic exist. The hit counts
   for the named timeouts do not exist yet.
3. Dashboard. Collect the timeout counts and show them in the coordinator
   dashboard, so the hit rates are visible without a debugger.
   Status, 15 Oct: partly done. The Live checks card is in the Metrics section.
   It does not show the timeout counts yet.

## Loose Ends (open, as of 15 Oct 2026)

These are open. Each is either an owner decision or work to do later. They are
listed here so that none is lost. The detail is in the cited reply.

Before any live run:

1. **The build and release record.** A version bump in `package.json`,
   `package-lock.json`, `manifests/chrome.json` and `manifests/firefox.json`, then
   the build. The release build should also be committed and tagged (AGENTS.md).
   The owner's call.
2. **The past-block audit.** Owner. Compare the profiles the tool has blocked
   with the Quora block list. Look for a blocked profile whose name is a cut
   prefix of a longer slug, such as `Jane` for `Jane-Type-Smith-7`. The unblock
   path is the worker's `unblock-unmute-profile` action and the content script's
   `unblockUnmuteProfile`.
3. **Profile search.** Keep it out of the first live run. Decide whether its
   match becomes exact before a later run (see "Profile search" in
   [architecture.md](architecture.md)).
4. **The live queue.** Check it for profile-resolution rows left by older runs.
5. **The stop rule.** In a canonical-only run, `liveCheck.resolvedBy.scored`
   must stay at zero. Any other value means a row was decided by a keyword scan.

Identity and landing:

6. **Dry-run mode (R4-6).** Designed, not built. Trace every path that starts a
   tab from `claimPendingTabAction` first. The check must read the page's own
   profile identity, not only the URL (review 5, R5-2).
7. **The query in identity.** Dropped, on the owner's view. The question for the
   Blockzooka author is unanswered, and the draft reply is unsent.
8. **Rows stored under cut keys.** Re-key them from their source pages, or clear
   them. Owner, not decided.
9. **Medium candidates.** Text URLs and post-URL artifacts are queued and nuked
   with no per-candidate check. Read the first candidate lists.
10. **Trailing prose punctuation.** A text URL has `[),.;:!?]` stripped before its
    identity is taken. This is outside the identity rule. Check that no slug ends
    in those characters.
11. **Whitespace.** Untrimmed, as the rule says. Owner to confirm.
12. **Manual requeue of "did not land" rows.** It can requeue the same link. Owner
    to decide whether to hide that.

Resolution and retry:

13. **The scored scan.** Kept and measured for resolution rows on question pages
    and space posts. Decide after the counts whether question-page resolutions
    may use it.
14. **The `mb_op=1` navigation.** It navigates to a scored guess. Deferred (owner's
    revisit list). Whether an automatic action follows the landing is not traced.
15. **"Did not land" for resolution rows.** The rule ends them too, not only
    canonical rows. Confirm that this is intended (review 5, response 2).

Clear and storage:

16. **A late write after the last re-read.** A write from an attempt that moved
    after the clear's last read. The milestone path rejects a missing row. The
    other writers have not been checked (R3-5 follow-up).
17. **The completed-row read in the clear.** `completedRecent(Number.MAX_SAFE_INTEGER)`
    is not measured (R3-6).
18. **The storage layering phases.** The phase boxes in
    [docs/queue-storage-layering.md](docs/queue-storage-layering.md) are as of
    11 Oct and were not re-verified in this update.

Other review items:

19. **Sender roles (R3-3).** Option C is documented for now. Option B after the
    eleven unknown senders are traced (owner).
20. **The latch rule (review 2, item a).** Decide once the counters have data.
21. **The pause residual (review 2).** Leave it until a teardown count exists.
22. **Hit counts for named timeouts** (to-do item 2). Not built.

Not verified, to be settled by the live run:

23. What Quora serves for fullwidth, trailing-hyphen, suffixed, lower-case and
    query links.
24. Whether a profile page exposes its own identity, and where.
25. What Quora does with a canonical link that does not land on a profile page.
26. The page-data scan on a real page (R4-7).

## Historical Or Supporting Notes

- [refactor-1.6-plan.md](refactor-1.6-plan.md): prior canonical plan for the
  `1.6` line. Keep it as detailed context; update this file first for new
  priority decisions.
- [top-level-rethink-1.5.md](top-level-rethink-1.5.md): durable-job design
  history carried forward into `1.6`.
- [top-level-rethink-1.5-execution-plan.md](top-level-rethink-1.5-execution-plan.md):
  detailed historical execution checklist. Useful for provenance, but current
  status must be rechecked.
- [coordinator-page-refactor-plan-2026-05-08.md](coordinator-page-refactor-plan-2026-05-08.md):
  older coordinator-page split plan now mostly absorbed by the `1.6` scheduler
  and dashboard work.
- [other-codex-ordered-handoff-2026-05-19.md](other-codex-ordered-handoff-2026-05-19.md):
  short-lived work ordering handoff. Preserve as a timestamped snapshot.
- [review-fix-checklist-2026-05-20.md](review-fix-checklist-2026-05-20.md):
  resolution record for dated review notes.
- [release-summary-1.6-aka-2.0.md](release-summary-1.6-aka-2.0.md):
  public release narrative draft, not an engineering plan.

## Rules For Future Notes

- New active work should update this file and, when architectural, also update
  [architecture.md](architecture.md).
- Dated notes are allowed as snapshots, investigations, review records, and
  handoffs. Their first section should say whether they are active, supporting,
  superseded, or historical.
- Avoid creating a new root plan unless it captures a bounded investigation or
  handoff. If it changes priority, fold the outcome back here.
