# Review Fix Checklist - 2026-05-20

> **Status: HISTORICAL** (24 Oct 2026). Checklist of the May review fixes. Complete. Kept as a record. Do not implement from it. planning.md is the front door. Register: [notes register](../docs/notes-register.md).

Scope: work down the open issues from the five 2026-05-19 review notes after the 1.6.328 pause/resume fixes.

Status: complete as an active checklist. Keep this file as the resolution
record for the 2026-05-19 review notes; do not use it as the next active work
plan unless one of the checked items regresses.

Canonical planning now starts at [planning.md](../planning.md). Canonical
architecture starts at [architecture.md](../architecture.md). This checklist is a
resolution record, not the current plan.

## Checklist

- [x] Storage serializer watchdog advances the queue after a timed-out update, instead of leaving later updates chained behind the abandoned promise.
- [x] `mbProfileNukeProgress` writes go through the serialized storage update path, not direct whole-map writes racing beside queue/runs writes.
- [x] Queue/runs/events/progress commits can include `mbSpacePendingNukedPosts` in the same storage payload where a transition needs both.
- [x] Space-feed enqueue no longer leaves queued progress rows behind when durable enqueue fails or accepts zero work.
- [x] Public recovery triggers can repair progress-only stranded work before deciding there is no stored work.
- [x] Stored-work repair scheduling tracks the earliest requested repair and has an alarm-backed wakeup where available.
- [x] Dashboard/manual resume returns a real recovery result or an explicit fallback result, not only "scheduled".
- [x] Stale content close rejection prevents `window.close()` fallback.
- [x] Tab-open failures requeue or schedule recovery instead of silently dropping the shifted in-memory action.
- [x] Slot release waits for required durable cleanup before opening the next slot when the prior tab has nonterminal or missing progress.
- [x] Contract tests cover the fixed invariants.
- [x] Version is bumped and validation/build are run without zip packaging or live push.

## Progress

- 2026-05-20: Checklist created.
- 2026-05-20: Implemented storage, progress authority, recovery, resume, and tab-lifecycle fixes; tests pass before version bump.
- 2026-05-20: Bumped to 1.6.329, ran `npm test` and `npm run prod`, and confirmed no zip artifacts were generated.
