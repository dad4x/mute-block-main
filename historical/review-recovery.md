> **Status: HISTORICAL** (24 Oct 2026). Early recovery sketch (20 May). Superseded. Kept as a record. Do not implement from it. planning.md is the front door. Register: [notes register](../docs/notes-register.md).

Status: superseded early review sketch.

Canonical planning now starts at [planning.md](../planning.md). Canonical
architecture starts at [architecture.md](../architecture.md). This scratch review
is superseded by the dated review notes and the completed review checklist; use
only for early design context.

Current status, 2026-05-19 cleanup:

This scratch review is superseded by the dated review notes and the completed
`review-fix-checklist-2026-05-20.md`. Keep it as an early architecture sketch,
not as the active defect list. The still-current theme is centralizing recovery
under service-worker/reducer authority; the concrete line references below are
stale and should be re-checked before reuse.

• Findings

  - High: recovery still has two sources of truth. mbCoordinatorQueue is supposed to be authoritative, but
    repair still promotes, restores, and reconciles state bidirectionally with legacy
    mbProfileNukeProgress: see shared/js/sw.js:1201, shared/js/sw.js:1530, and shared/js/sw.js:1660. This
    is the main band-aid shape: the compatibility mirror is also a repair input. I’d split this into a
    narrow ProgressMirror that only derives progress from queue, plus a one-shot/explicit migration path
    for stranded legacy rows.
  - High: repair orchestration is scattered across UI, storage listeners, release paths, startup, alarms,
    and status reads. The coordinator asks for repair on load at shared/js/coordinator.js:66, the service
    worker schedules restore/repair from stored work at shared/js/sw.js:2383, release paths trigger repair
    at shared/js/sw.js:7094, storage changes trigger restore/repair at shared/js/sw.js:8474, and even get-
    owned-nuke-status restores stored work at shared/js/sw.js:8677. That makes recovery behavior hard to
    reason about. I’d centralize this as one service-worker repairStoredWork(reason) scheduler with
    explicit phases: adopt live tabs, settle terminal rows, refill queue, mirror progress.
  - Medium: foreground fallback is half-retired but still wired through APIs.
    waitForMenuStateWithForegroundFallback() hard-disables allowForegroundFallback at shared/js/
    content.js:3652, and ensureProfileMenuOpen() does the same at shared/js/content.js:11744, while callers
    still pass the flag through. That is classic leftover patch scaffolding. Since the action lease is now
    the real gate, I’d remove the old promote-fallback branches or rename these helpers so the foreground
    path is unambiguous.
  - Medium: retry policy is embedded in cleanup/action code instead of the job model. Stale-tab retry is
    governed by STALE_QUEUED_TAB_MAX_RETRIES = 1 at shared/js/sw.js:65, then buildRetryQueuedTabAction()
    requeues in memory while carrying the existing attempt identity at shared/js/sw.js:6697. Reverse repair
    has its own local maxReverseAttempts = 3 at shared/js/content.js:11209. These should become reducer-
    owned retry events that create explicit new attempts, with content scripts reporting failure reasons
    rather than deciding retry loops.
  - Low: the tests are preserving patch shape more than behavior. There are useful invariants in test/p1-
    contract.test.js, but many assertions lock in current implementation details like retry count, best-
    effort repair, claim nudges, and local action-gate fallback, for example test/p1-contract.test.js:281
    and test/p1-contract.test.js:297. I’d keep a few contract tests, but move more coverage into pure job-
    state scenarios: restart during opening, terminal after retry, missing tab adoption, lease expiration,
    and source settlement.

  The good organizing nucleus is already there: jobState.js has a reducer and attempt checks, and the
  service worker has storage serialization and durable action leases. The cleanup path is to move more
  recovery decisions into that model and delete compatibility branches as soon as they are one-way mirrors.
