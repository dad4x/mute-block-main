# Progress vs Queue Authority Review - 2026-05-19

Status: partially resolved review record.

Canonical planning now starts at [planning.md](planning.md). Canonical
architecture starts at [architecture.md](architecture.md). The remaining theme
is captured in the canonical authority/reconciler model; recheck source before
using line-specific findings.

Review target: interactions between legacy `mbProfileNukeProgress`, durable Current Work rows, reducer transitions, and content-script progress acknowledgements.

Scope: `shared/js/content.js`, `shared/js/sw.js`, `shared/js/jobState.js`, and narrow contract-test coverage around progress/queue authority. This review is intentionally standalone and does not rely on findings from the other review notes.

## Current Status

Status: partially resolved.

Resolved by the `1.6.329` fix pass tracked in
`review-fix-checklist-2026-05-20.md`:

- progress written before durable enqueue no longer leaves authoritative queued
  work behind when enqueue fails or accepts zero work;
- terminal content paths now have contract coverage for service-worker
  acknowledgement before release/close.

Still-current design debt:

- the broader reducer-authority split remains a design concern. Current source
  has more reducer coverage than when this note was written, but service-worker
  authority is still distributed across adapters, repair, and compatibility
  paths. Treat the P2 architecture section below as still useful, but treat the
  P1 defects as historical unless a fresh review reproduces them.

## Findings

### P1: Progress rows can still resurrect work that was never durably enqueued

The space-feed path writes queued progress before it submits durable coordinator items. `nukeSpaceFeedEntries()` calls `recordProfileNukeProgressBatch()` for URL-backed profile associations (`shared/js/content.js:8598`), then registers pending source records (`shared/js/content.js:8608`), and only then sends `enqueue-coordinator-items` (`shared/js/content.js:8612`).

If enqueue returns no accepted work or fails after the progress batch was recorded, the rollback path removes resolver/source pending entries (`shared/js/content.js:8627`) but does not clear the queued profile progress rows. The service worker repair path later treats stranded `status: 'queued'` progress with a `runId` as sufficient authority to recreate Current Work (`shared/js/sw.js:1570`, `shared/js/sw.js:1580`, `shared/js/sw.js:1591`, `shared/js/sw.js:1633`).

Impact: a user can see `Nothing queued`, or an enqueue failure can be handled locally, but a later storage repair can recreate and run that work from the progress mirror alone.

Recommendation: make durable queue creation happen before progress is written, or tag pre-enqueue progress as provisional and have repair ignore it unless the matching run/queue enqueue commit exists. If rollback removes pending entries, it should also clear the provisional progress rows.

### P1: Content terminal paths release and close without requiring a recorded terminal write

Queued content progress uses the service-worker job protocol when `isActiveQueuedProgressRecord()` is true (`shared/js/content.js:853`, `shared/js/content.js:858`). The returned record exposes `runtimeRecorded` and `staleAttempt` (`shared/js/content.js:881`), but terminal helpers do not gate release/close on that acknowledgement.

For example, `closeQueuedBlockedTab()` awaits `recordQueuedProfileProgress({status: 'blocked', ...})`, then releases the slot and requests tab close regardless of whether the service worker recorded the terminal row (`shared/js/content.js:9937`, `shared/js/content.js:9947`, `shared/js/content.js:9948`). The unblock/unmute success path has the same shape (`shared/js/content.js:10406`, `shared/js/content.js:10414`, `shared/js/content.js:10415`).

If the terminal message times out or returns non-recorded, `tabs.onRemoved` later records only close metadata when the tab was intentionally closed (`shared/js/sw.js:8717`, `shared/js/sw.js:8726`, `shared/js/sw.js:8740`). Metadata-only progress is intentionally not supposed to transition Current Work. That can leave the durable queue active until repair times it out, despite the page having completed the action.

Recommendation: terminal content paths should require `runtimeRecorded` before releasing the job slot or closing the tab. If terminal recording fails, retry through the service worker or leave the tab/slot in a recoverable state instead of converting success into a later timeout.

### P2: The reducer authority boundary is still split between two representations

The reducer in `jobState.js` maps progress statuses into queue statuses (`shared/js/jobState.js:150`, `shared/js/jobState.js:220`). The service worker then applies additional authority rules: service-worker-owned rows ignore nonterminal progress in `syncCoordinatorProgressRecordsLocked()` (`shared/js/sw.js:1268`, `shared/js/sw.js:1290`) and in repair (`shared/js/sw.js:1863`, `shared/js/sw.js:1888`), while terminal progress can still transition queue rows (`shared/js/sw.js:1892`, `shared/js/sw.js:1901`).

This split is defensible, but it is not expressed as one reducer contract. Callers have to know whether they are sending a legacy progress mirror update, a deferred milestone, a terminal job event, or a repair input. That makes it easy to add a new path that calls the right mapper but bypasses the authority rules.

Recommendation: make the reducer accept explicit event sources, such as `content-milestone`, `content-terminal`, `repair-progress`, and `queue-authoritative-repair`, and keep the queue-authority checks in that reducer instead of distributing them across sync, repair, and request handlers.

## Notes

The current code has meaningful protections: queued content progress is routed to `record-job-milestone` or `record-job-terminal` rather than direct content storage writes (`shared/js/content.js:864`), and same-attempt stale terminal failures are guarded by attempt checks before queue transitions (`shared/js/sw.js:1258`, `shared/js/sw.js:1750`, `shared/js/sw.js:8210`). The remaining issues are about which state gets to create or complete durable work.
