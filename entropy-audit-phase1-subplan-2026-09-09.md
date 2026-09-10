# Phase 1 Audit Sub-Plan — 2026-09-09

Companion to `entropy-reduction-action-plan-2026-09-09.md`. This splits the
Phase 1 recon into 3 file-scoped research tasks (grouped by area rather than
by pattern, to avoid multiple agents each re-reading the same large files)
suitable for delegating to lower-context research agents. Each task is
read-only: locate and describe instances, do not fix anything.

Each task's report should be a flat list of findings, one per instance:
`file:line — one-line description of the pattern instance — rough
risk (low/medium/high) — one-sentence reason for the risk rating`. Findings
should be concrete, quoted-from-the-file evidence, not speculation. A
pattern search that turns up nothing should say so explicitly rather than
stretching to find matches — a short, accurate report beats a padded one.

## Task A — content.js: heuristic fallbacks, budget mismatches, unset fields

Scope: `shared/js/content.js` only.

Look for:
- **Pattern 2 (unscoped heuristic fallback):** ranking/scoring functions
  that pick the best of a set of DOM candidates across an unbounded search
  space (e.g. `document.querySelectorAll` over the whole document rather
  than a scoped root), particularly ones with a numeric score and a low
  floor, or a fallback branch that fires when a more targeted lookup fails.
  `getGlobalPrimaryAction`/`scoreActionCandidate`/`getDialogPrimaryAction`
  are the known instance — look for siblings with a similar shape (a
  candidate-scoring helper with a "no dialog root, so search everywhere"
  escape hatch).
- **Pattern 5 (nested wait-loop budget mismatch):** call chains of
  `waitForCondition`/`waitForAction`/`waitForProfileMenuState`/
  `waitForMenuStateWithForegroundFallback`/similar `waitFor*(..., timeoutMs,
  intervalMs)` helpers where an outer wait's timeout is not comfortably
  larger than an inner wait's timeout times a plausible retry count. Note
  the exact numbers found on each side.
- **Pattern 3 (restricted-domain field never set on some path):** functions
  that build a progress patch object (calls to `recordCurrentProfileNukeProgress`,
  `noteCurrentProfileNukeProgress`, `recordProfileNukeProgress`) — for each
  distinct action flow (mute, block, unblock, unmute, reverse-action,
  queued/claimed-action paths), check whether `actionKind` is explicitly set
  somewhere in that flow's *first* patch, or whether it's left to inherit
  from `previous`. List any flow where you cannot find an explicit
  `actionKind:` in its patches.

## Task B — sw.js + progress/coordinator modules: stale invariants, duplicated constants, delete/reset races

Scope: `shared/js/sw.js`, `shared/js/swProfileNukeProgress.js`,
`shared/js/swProfileProgressMerge.js`, `shared/js/jobState.js`,
`shared/js/swCoordinatorProgressReducer.js`,
`shared/js/swProfileNukeRecordClassification.js`,
`shared/js/swCoordinatorStatusRules.js`.

Look for:
- **Pattern 1 (stale invariant proxy):** conditions that check one field
  (commonly `actionKind`, but also `status`, presence of a key) as a stand-in
  for a broader classification (queued vs. legacy/direct, active vs.
  terminal, owned vs. foreign) without an explicit discriminator field
  (like `attemptId`/`attemptNumber`/`runId`) alongside it. The fixed
  instance tonight was `clearProfileNukeState`'s `preserveCoordinatorState`
  (now requires `attemptId`) — look for other conditions with the same
  shape that *don't* have such a guard.
- **Pattern 6 (duplicated constants):** literal string constants for
  action-kind/status/reason values (e.g. `'mute-block'`, `'unblock-unmute'`,
  `'queued'`, `'blocked'`) declared as local `const` in more than one file
  in this scope, or declared here *and* independently in `content.js`
  (`content.js` already declares `UNBLOCK_UNMUTE_ACTION_KIND = 'unblock-unmute'`
  at its own top level — confirm whether `jobState.js`'s copy and this one
  are ever imported from a shared source or are truly two independent
  declarations, and look for other constants with the same split).
- **Pattern 4 (delete/reset racing async writers):** places that `delete`
  a key from a shared in-memory or stored map (`profileNukeProgress`,
  `mbCoordinatorQueue`, similar), or otherwise reset a keyed record to a
  fresh/empty value, where a fire-and-forget write elsewhere could still be
  in flight for that same key. `clearProfileNukeState` was the fixed
  instance (now tombstones) — look for other `delete nextX[key]` /
  `nextX[key] = {}`-shaped mutations in these files.

## Task C — Storage-abstraction boundary

Scope: `shared/js/swstorage.js`, `shared/js/swProfileNukeProgress.js`, plus
a grep across `shared/js/sw.js` for calls to the low-level primitives those
two files export (`metricStorageGet`, `metricStorageSet`,
`saveProfileNukeProgressRowProjection`, `deleteProfileNukeProgressRowProjection`,
`getProfileNukeProgressShardKey`/`getProfileNukeProgressShardDefaults`,
any `appendWalRecords*`/WAL-checkpoint functions, `updateProfileNukeProgressViewRecords`/
`updateProfileNukeProgressShardRecord`), and a grep across `test/*.js` for
assertions that reference WAL segment keys/counts, shard keys, or other
storage-internal representation directly rather than through a
behavior-level API.

Look for:
- **Pattern 7 (storage leakage), concretely:**
  1. Call sites in `sw.js` (i.e. *outside* the two storage-module files)
     that call shard-key builders, WAL-append functions, or raw
     `metricStorageGet`/`metricStorageSet` directly, rather than going
     through a projection-level function like
     `saveProfileNukeProgressRowProjection`. Each such call site is a place
     business logic has to know about sharding/WAL to work correctly.
  2. Any other explicit field allowlist like
     `summarizeProfileNukeProgressRecord`'s (a function that spells out a
     fixed list of named fields to copy from a source object) in these
     files — each one is a second, disconnected source of truth from
     whatever constructs the object being summarized, and a forgotten field
     silently drops rather than erroring.
  3. Tests in `test/*.js` whose assertions reference storage-internal
     representation directly — WAL segment key names/counts, shard key
     names, raw `mbCoordinatorQueueWal.*` keys, etc. — rather than
     asserting on observable behavior. List the test name and what
     internal detail it's coupled to.

## Coordinator instructions (for me, not the sub-agents)

- Launch all three as background `general-purpose` agents in parallel
  (independent scopes, no ordering dependency).
- Each prompt must be self-contained: paste the relevant task section above
  verbatim, plus the shared "report format" instructions, plus explicit
  "read-only, do not edit files" instruction.
- On each report landing, fold findings into a new "## Phase 1 Findings"
  section of `entropy-reduction-action-plan-2026-09-09.md` under a
  subsection per task, then update the Phase 1 status line once all three
  are in.
- Do not let agents chase fixes — if one proposes a fix inline, keep only
  the finding for the plan doc and note the suggestion separately if it
  seems cheap and obviously safe, for later phases.
