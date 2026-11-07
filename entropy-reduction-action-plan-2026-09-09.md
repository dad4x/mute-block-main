# Entropy Reduction Action Plan — 2026-09-09

> **Status: CURRENT** (24 Oct 2026). Reference list of recurring problems. AGENTS.md requires reading it before non-trivial sw.js changes. A checklist to apply, not a plan to execute. Current reference. Read it before non-trivial sw.js changes (AGENTS.md). A checklist, not a plan to execute. Register: [notes register](docs/notes-register.md).

## Motivating problem

This codebase has been extensively edited across many sessions by different
AI models and agents, often working with limited context and no shared,
enforced set of conventions. That produces a specific, recurring failure
shape: local fixes that are individually reasonable but rely on an implicit
invariant elsewhere in the codebase, which later erodes silently when a
different session (with no visibility into that invariant) changes the thing
it depended on. This document exists so that the *next* low-context session —
of any model — has something durable to read before repeating the pattern,
rather than rediscovering it from scratch. That's itself part of the fix
(see Phase 5).

Concrete origin: a single live-testing session (2026-09-09, documented in
`historical/live-testing-todo-2026-09-08.md`) chasing one reported bug (an
internally-inconsistent persisted profile-progress record) surfaced four
independent, unrelated bugs stacked on top of each other, each a different
instance of the same underlying gap: no schema/typed-union discipline for
state that different code paths mutate independently over time.

## Named patterns (see historical/live-testing-todo-2026-09-08.md for the concrete bugs each was drawn from)

0. **Untyped, unioned progress record (the root pattern).** `profileNukeProgress[href]`
   is one flat object accumulating fields from conceptually distinct action
   kinds (`mute-block` vs `unblock-unmute`) via unconditional spread-merges
   (`normalizeProgressPatch` in `swProfileProgressMerge.js`,
   `normalizeProfileProgressPatch` in `content.js`). No schema makes an
   incoherent combination (e.g. `status: "blocked"` alongside
   `unblockReason: "unmuted"`) inexpressible — only scattered, partial,
   ad hoc guards do, and those guards are exactly the kind of thing that
   erodes across editing sessions.
1. **Stale invariants baked into boolean expressions.** A condition uses one
   field's value as a proxy for a broader classification (e.g. "does this
   `actionKind` imply a queued attempt?") without an explicit discriminator.
   The proxy was true only because of a *now-changed* absence elsewhere.
   Example: `clearProfileNukeState`'s `preserveCoordinatorState` check.
2. **Unscoped "best effort" fallback search with no relevance floor.** A
   ranking/scoring function picks "best of what's available" across an
   unbounded search space, with no hard requirement tied to the caller's
   actual intent — safe only until something unrelated scores well by
   accident. Example: `getGlobalPrimaryAction`.
3. **Restricted-domain fields some code paths never populate.** A field like
   `actionKind` or `status` is read in branching logic everywhere, but at
   least one constructor of the record never sets it, relying on inheritance
   through a merge. Example: legacy `muteProfile()` never stamping
   `actionKind`. (Deferred per user decision — see Phase 3.)
4. **Delete/reset racing fire-and-forget writers.** Clearing or resetting a
   keyed piece of shared state erases the comparison basis a still-in-flight
   async write needs to detect its own staleness. Example:
   `clearProfileNukeState` used to hard-delete instead of tombstone.
5. **Nested wait-loop budgets that don't add up.** An outer `waitFor*`
   timeout gives an inner `waitFor*`/read call nearly its entire budget in
   one attempt, leaving no room for a real retry. Example:
   `unmuteProfileBestEffort`'s `waitForProfileMenuState(..., 2500, 250)`
   wrapping a `readProfileMenuState(..., 1800, 200)`.
6. **Duplicated constants across a module boundary.** The same literal value
   (e.g. `UNBLOCK_UNMUTE_ACTION_KIND = 'unblock-unmute'`) is independently
   declared in more than one file rather than shared from one source, so a
   typo'd rename in one place silently breaks cross-boundary matching.
7. **Storage-abstraction leakage.** `swstorage.js`/`swProfileNukeProgress.js`
   exist to encapsulate WAL/batching/sharding, but business logic in `sw.js`
   still calls low-level primitives directly and must know about
   shards/views/WAL to use them correctly. Concrete leak found live tonight:
   `summarizeProfileNukeProgressRecord`'s explicit field allowlist is a
   second, disconnected source of truth from whatever constructs a patch —
   forgetting to add a new field there silently drops it on every durable
   write, with nothing that fails loudly. Also: tests asserting on WAL
   segment counts directly (an implementation detail) rather than on
   behavior is the same leak showing up in the test suite.
8. **Scattered timeout/interval magic numbers, no symbolic registry.**
   `waitFor*(..., timeoutMs, intervalMs)` call sites (Pattern 5's root
   cause) each invent their own numeric literals with no shared vocabulary
   for what a given wait represents (a quick single-attempt check vs. a
   multi-attempt retry budget vs. a full end-to-end verification), so
   there's no way to reason about or tune the system's overall patience as
   a whole. See [[feedback-symbolic-timeout-registry]] (project memory) —
   deferred by the same reactive policy as Phase 3's setter work, seeded by
   the next real timeout bug that needs fixing anyway rather than built
   proactively.

## Phases

- **Phase 1 — Recon, no code changes.** Inventory real instances of each
  pattern above. Output is a findings doc, not fixes. *(In progress — see
  sub-plan below.)*
- **Phase 2 — Tripwires at the exact leak points Phase 1 finds.** Cheap,
  targeted tests that turn silent entropy into a loud CI failure without any
  architectural change. Two known in advance: (a) a schema-consistency test
  asserting every field ever written into a progress-record patch also
  appears in `summarizeProfileNukeProgressRecord`'s allowlist; (b) an
  equality test asserting independently-declared action-kind constants
  match across files. *(Not started.)*
- **Phase 3 — Reactive schema/setter work, deferred by design.** Introducing
  validated setters/constants for restricted-domain fields (pattern 1, 3, 6)
  happens opportunistically, "as it comes up" against a real bug — not as a
  scheduled sweep. See
  `../memory/feedback_restricted_domain_setters.md` (project memory) for the
  standing rule. Expected to also address the storage-boundary gap (pattern
  7) and the untyped-union root pattern (0), per user note 2026-09-09.
  *(Not started; triggers opportunistically.)*
- **Phase 4 — Storage-abstraction boundary, scoped separately.** Bigger than
  a tripwire can fix. Needs its own design pass once Phase 1 shows how many
  call sites actually reach past the `swstorage.js`/`swProfileNukeProgress.js`
  boundary. *(Not started; likely folds into Phase 3's schema work rather
  than being fully separate — re-evaluate after Phase 1.)*
- **Phase 5 — Process.** A short "known traps" pointer in `AGENTS.md` linking
  to this document, so the next low-context session (of any model) reads it
  before repeating one of the patterns above. *(Not started.)*

## Phase 1 Findings (2026-09-09)

Three scoped research agents ran in parallel (content.js; sw.js + progress
modules; storage-abstraction boundary). Raw per-instance findings below;
each entry is `file:line — description — risk — reason`.

### Task A — content.js

**Pattern 2 (unscoped heuristic fallback), beyond the already-fixed
`getGlobalPrimaryAction` cluster:**
- `content.js:3215` `getProfileMenuButtonFallback` — scores every menu-like
  button across the whole main content area (not just a row) when the
  narrow row-anchored lookup fails, floor `score > 0` — risk: medium — could
  pick an unrelated "more options" menu on a busy page.
- `content.js:5379` `getOriginalPosterProfileHref()`'s `scoreOriginalPosterLink`
  fallback — scores every visible profile link in `main`/`document.body` by
  nearby keywords when inline-data lookup fails — risk: medium — thin/
  ambiguous surrounding text could misidentify a commenter/follower as the
  original poster, driving nuke/report targeting at the wrong profile.
- `content.js:11709` `getInPageConfirmPairAction` (used by
  `getUnmuteConfirmAction`'s fallback) — unlike its sibling
  `getUnblockConfirmAction`, scans the **entire document** for a confirm
  button when the dialog-scoped lookup is empty — risk: medium-high — on a
  page listing several other muted users' own controls (settings/
  notifications), could click a different profile's unmute control.

**Pattern 3 (`actionKind` left unset), a second real gap beyond the
already-fixed `muteProfile()` entry point:**
- `content.js:12457-12462` — the "already unblocked, just unmute" branch of
  `unblockUnmuteProfile()` calls `unmuteProfileBestEffort()` directly with
  no preceding progress-patch call, and `unmuteProfileBestEffort()` itself
  never records any patch — risk: high — for a fresh href entering this
  branch, `actionKind` can stay permanently blank, and this is likely the
  single most common "reverse" case (unmuting something that was never
  blocked).
- `content.js:4653-4692` (`handleUnblockUnmuteClick`) and `content.js:1990-1994`
  (the `'unblock-unmute-profile'` message handler) — both real entry points
  into the branch above, neither stamps `actionKind` upstream either — risk:
  medium — no safety net catches the gap before it reaches
  `unblockUnmuteProfile`.

**Pattern 5 (nested wait-loop budget mismatch) — a systemic shape, not one
instance:** every `waitForProfileMenuState(expectedState, ..., outerMs,
outerIntervalMs)` caller loops an inner `readProfileMenuState(..., 1800,
200)` that costs up to ~2200ms per call regardless of the outer interval
requested.
- `content.js:12764` (`blockProfile`'s early-applied check) outer `(1500,
  200)` — risk: high — inner floor alone exceeds the whole outer budget;
  can never complete one full iteration.
- `content.js:12281` (`unmuteProfile`) outer `(2500, 500)` — risk: high —
  ~300ms margin, effectively single-shot.
- `content.js:12348` (`unmuteProfileBestEffort`, the originally-flagged
  instance) outer `(2500, 250)` — risk: high — same shape.
- `content.js:4214` (`waitForVerifiedProfileUnblocked`) and `content.js:12288`
  outer `(5000, 500)` — risk: medium — only 1-2 real iterations possible.
  **This is very likely the mechanism behind the live-testing session's
  unexplained "unblock verification keeps failing under repeated cycling"
  finding** (see historical/live-testing-todo-2026-09-08.md) — the budget is tight
  enough that any real added latency (Quora-side lag, extra CPU load) can
  exhaust it before a second attempt lands.
- `content.js:4313` (`waitForVerifiedProfileBlocked`) outer `(6000, 500)` —
  risk: medium-low — ~2 iterations.
- `content.js:12297`/`12598` outer `(8000, 500)` — risk: low — ~3
  iterations, adequate as-is.

### Task B — sw.js + progress/coordinator modules

**Pattern 1 (stale invariant proxy):** no new instances beyond the
already-fixed `preserveCoordinatorState`. Every other `actionKind ===
UNBLOCK_UNMUTE_ACTION_KIND` site checked branches on the field's own literal
meaning (selecting unblock-flow fields vs. block-flow fields), not as a
stand-in for an unrelated classification; places that actually need to
decide queued-vs-legacy or ownership already check explicit fields
(`attemptId`, `serviceWorkerOwned`) alongside status/actionKind.

**Pattern 6 (duplicated constants):**
- `content.js:179` independently declares `UNBLOCK_UNMUTE_ACTION_KIND =
  'unblock-unmute'` even though `content.js` already imports from
  `jobState.js` (which exports this exact constant) elsewhere — risk:
  medium — currently in sync, but nothing stops future drift.
- `sw.js:367` `TERMINAL_COORDINATOR_STATUSES` duplicates `jobState.js:18`'s
  `TERMINAL_JOB_STATUSES` (identical set) — risk: low — dead code (never
  referenced again after declaration), but a live duplicate waiting to be
  picked up.
- **Confirmed drift, not just duplication:** `content.js:218`
  (`TRANSIENT_PROFILE_NUKE_STATUSES`) vs. `jobState.js:19-30`
  (`TRANSIENT_PROGRESS_STATUSES`) vs.
  `swProfileNukeRecordClassification.js:179-190`
  (`isTransientProfileNukeStatus`'s inline Set) — three independent copies
  of the "transient status" list, and **content.js's copy is missing
  `'unmuting'` and `'unblocking'`** that the other two include — risk: high
  — content.js's transient-status check silently disagrees with the
  service worker's classification for unblock/unmute-in-progress states.
- Adjacent, flagged for awareness: `isExplicitSecurityVerificationRecord`
  has an identical duplicated body (not just a constant) in both
  `jobState.js:123-135` and `swProfileNukeRecordClassification.js:164-176`.

**Pattern 4 (delete/reset racing fire-and-forget writers) — the fixed bug's
sibling code paths, not fully covered by the original fix:**
- `sw.js:19799-19804` (failed-retry coordinator-authority path) and
  `sw.js:20121-20126` (sibling failed-requeue path) — both do `delete
  profileNukeProgress[href]` directly on the same shared map
  `clearProfileNukeState` was fixed to stop doing this to — risk: high —
  same failure shape as the fixed bug, duplicated into two more code paths
  the original fix didn't cover.
- `swProfileNukeProgress.js:316-323`/`346-350` (view/shard record removal)
  — risk: low — these are derived/rebuildable display projections, not the
  authoritative merge record, so a stale write landing after deletion only
  leaves a stray UI-visible entry until the next rebuild.

### Task C — Storage-abstraction boundary

**Leakage into `sw.js`'s read/rebuild paths (write paths are comparatively
well-contained):**
- `sw.js:42-61` — top-level `require('./swstorage')` pulls in low-level WAL
  primitives (segment/checkpoint/generation functions) directly into
  business-logic file scope — risk: high.
- `sw.js:1901,1929` — `metricStorageGet`/`metricStorageSet` are thin
  metric-wrapped passthroughs *defined in sw.js itself*, then called ~90
  times throughout with hand-assembled raw storage keys — risk: high — no
  single choke point enforces correct key combinations.
- `sw.js:6129,6393` — `appendWalRecordsToGeneration` called directly in
  `persistCoordinatorAuthorityQueueWalMutation`/its batch sibling, in
  parallel with the *wrapped* path via `swCoordinatorQueueWal.js` that
  sw.js also uses elsewhere — risk: high — two parallel append paths whose
  consistency depends on convention, not construction.
- ~8+ functions (e.g. `loadCoordinatorQueueRunsProgressProjection` and
  siblings at `sw.js:8032-8090,8100-8340,9000-9050,20730-20800,30153-30170`)
  each independently re-implement the same "assemble defaults → get →
  recover WAL → reproject" recipe — risk: high — duplicated recipe means
  duplicated chances to get a key or call order wrong.
- By contrast, `saveProfileNukeProgressRowProjection`/
  `deleteProfileNukeProgressRowProjection` correctly centralize the *write*
  path, and most steady-state writes already go through them — the leakage
  is concentrated in reads/rebuilds and the WAL-append path, not writes.

**Field-allowlist depth:** only one allowlist of this shape exists in the
audited storage files —
`swProfileNukeProgress.js:96-152` `summarizeProfileNukeProgressRecord`,
**44 fields**, the single choke point every persisted progress record
passes through — risk: high by depth (44 fields, no compile-time or
runtime check that it stays in sync with whatever constructs records in
sw.js), not by breadth (no second disagreeing allowlist found).

**Tests coupled to storage-internal representation:** concentrated in
`test/swSynthetic.test.js` (51 references to internal WAL/shard key
literals, vs. 11 and 6 in `walSnapshotStore(Fuzz).test.js`, which are the
storage module's own expected unit tests). Notable: `swSynthetic.test.js:3133,3218`
assert directly on WAL segment/checkpoint key names and payload key
membership rather than on observable queue state; `:3295,3351,3403`
fabricate internal meta/segment-count shapes directly; several tests
(`:2434,2767,2900,2987`) filter/delete by the `mbProfileNukeProgressShard.`
key prefix even though their names suggest they're testing projection
*behavior*, not key format.

## Status log

- 2026-09-09: Plan created. Phase 1 sub-plan drafted (see
  `historical/entropy-audit-phase1-subplan-2026-09-09.md`), farmed out to 3 scoped
  research agents. All three completed same day; findings folded in above.
  Phase 1 complete. Re-evaluating with user before starting Phase 2.
- 2026-09-09 (same day): User approved fixing the "obvious" confirmed bugs
  from Phase 1 findings immediately, ahead of the phased tripwire/deferred
  work. Fixed, rebuilt as `1.6.1228`, full test suite green:
  - `TRANSIENT_PROFILE_NUKE_STATUSES` drift (content.js was missing
    `'unmuting'`/`'unblocking'`) — eliminated by importing
    `TRANSIENT_PROGRESS_STATUSES`/`UNBLOCK_UNMUTE_ACTION_KIND` from
    `jobState.js` instead of re-declaring locally, removing both duplicates
    at the source rather than just patching the values.
  - Dead duplicate `TERMINAL_COORDINATOR_STATUSES` in `sw.js` — deleted
    (confirmed unused).
  - The two sibling delete-instead-of-tombstone sites (`sw.js`'s
    failed-retry and failed-requeue progress-cleanup paths) — fixed using a
    new shared `makeTombstonedProfileProgressRecord(profileHref)` helper,
    also adopted by `clearProfileNukeState` to remove the third copy of the
    same tombstone-construction literal. Updated the two `swSynthetic.test.js`
    tests and two `p1-contract.test.js` source-shape assertions that
    expected the old delete-based behavior.
  - The second `actionKind`-never-set gap: `unblockUnmuteProfile()`'s
    "already unblocked, just unmute" branch now calls
    `recordReverseActionProgress` (stamping `actionKind:
    'unblock-unmute'`) before `unmuteProfileBestEffort()`, matching the
    `startedBlocked` branch's existing behavior.
  - Not fixed in this pass (left for Phase 2/3 as originally scoped): the
    unscoped heuristic-fallback instances (Pattern 2), the nested
    wait-loop budget mismatches (Pattern 5, including the one likely
    behind the live-testing verification-timeout finding), and the
    storage-abstraction leakage (Pattern 7) — these need design judgment
    (new timeout values, narrowing a search scope, or a boundary redesign)
    rather than being a mechanical, obviously-correct change.
- 2026-09-10: Phase 2 complete (both tripwires landed, test-only, no
  extension rebuild needed, full suite green):
  - `test/swSynthetic.test.js` — new test `'profile-progress field
    allowlist round-trips every known field (schema tripwire)'` sends a
    `record-direct-profile-progress` message with every field
    `summarizeProfileNukeProgressRecord` knows about set to a distinguishable
    sentinel value, then asserts the compact view record and the sharded
    storage record both deep-equal the expected shape. Caught one real
    subtlety while writing it: `terminalAt` is intentionally re-stamped to
    server `now()` whenever a record's success state newly reaches a
    terminal status (`swProfileProgressMerge.js`'s `successChanged` check),
    overriding whatever the patch claims — not a round-trip failure, and
    now documented in the test itself. Known, accepted limitation: this
    catches an *existing* field silently breaking (removed from the
    allowlist, a typo, a dropped mapping), not a *brand-new* field nobody
    thought to add to this test's fixture — there's no independent second
    schema to diff against, since the allowlist function is the only place
    the record shape is named as a group.
  - `test/p1-contract.test.js` — new test `'isExplicitSecurityVerificationRecord
    stays identical across its two independent declarations'` asserts the
    function bodies in `jobState.js` and `swProfileNukeRecordClassification.js`
    stay textually identical (whitespace-normalized), matching this file's
    existing source-shape-assertion convention.
  - Triage of the remaining Phase 1 defer list (Patterns 2, 5, 7) starts
    next, to split "actually cheap once you look closely" from "needs its
    own design session" before doing any more fixing.
- 2026-09-10: Triage conclusion — all three remaining patterns deferred, no
  code changes this round:
  - **Pattern 2 (heuristic fallbacks)**: on closer reading,
    `getInPageConfirmPairAction`'s document-wide fallback in
    `getUnmuteConfirmAction` isn't a redundant unguarded copy of a pattern
    its sibling `getUnblockConfirmAction` already solves safely —
    `getUnblockConfirmAction` has no such fallback at all, it just returns
    null. Removing it would trade a rare false-positive risk (clicking
    someone else's unmute button) for a new false-negative risk (unmute
    confirmation silently failing whenever the scoped lookup is empty) —
    a real tradeoff needing live-testing validation, not a mechanical fix.
    All of Pattern 2 stays deferred.
  - **Pattern 5 (wait-loop budgets)**: reading `readProfileMenuState`'s
    actual cost model closely (not just the audit summary) showed it's
    more nuanced than flat per-attempt cost — the 400ms sleep is
    unconditional but the up-to-1800ms poll ceiling only gets paid in the
    slow/failure case, and some flagged sites (e.g. `unmuteProfile`'s
    `unmutedWithoutConfirm` → `unmutedAfterDismiss` pair) are already a
    working two-stage retry, not a single broken wait. One case
    (`blockProfile`'s `blockedAppliedEarly`, outer `1500ms/200ms`) is
    unambiguously broken — its own inner attempt alone can exceed that
    budget. Decided not to patch even that one now: doing so would mean
    planting one more scattered magic-number literal, which is exactly
    what the newly-captured symbolic-timeout-registry idea (Pattern 8,
    below) argues against, and unlike the `actionKind` fix this was found
    by static reading, not a live-observed failure — doesn't meet the same
    bar that triggered Phase 3-style reactive work elsewhere. Deferred in
    full alongside Pattern 8's registry.
  - **Pattern 7 (storage leakage)**: deferred as originally scoped, no
    change to that assessment.
  - New pattern captured during this triage, not from Phase 1's original
    audit: **Pattern 8, scattered timeout/interval magic numbers, no
    symbolic registry** (see the patterns list above and
    [[feedback-symbolic-timeout-registry]] project memory) — same reactive
    trigger discipline as Phase 3's setter work.
  - Moving on to Phase 4's own recon (storage-abstraction boundary, deeper
    than Phase 1's initial survey) and Phase 5 (process) next.
- 2026-09-10: Phase 5 complete — added a "Known Architectural Traps" section
  to `AGENTS.md` pointing at this document, so the next low-context session
  reads it before touching `sw.js`/`content.js`/the progress/storage
  modules. Phase 4 deep recon launched (background research agent): going
  beyond Phase 1's survey-level findings to catalog the duplicated
  read/rebuild recipe functions precisely (near-identical vs. genuinely
  different behavior), assess whether the two parallel WAL-append paths
  can be unified, categorize the ~90 raw storage-key call sites by whether
  they have an obvious consolidation target, assess per-test whether the
  storage-internals-coupled tests could be rewritten behaviorally, and
  propose 2-3 concrete candidate consolidation designs with tradeoffs.
  Findings to be folded in below once it completes.
- 2026-09-10: Phase 4 deep recon complete, findings folded in below
  ("Phase 4 Findings" section). Recon-only, no code changes. Re-evaluating
  with user on whether Option C (completing the WAL-append wrapper) is
  cheap/safe enough to do now, or whether all of Phase 4 stays as pure
  design input for later, as originally scoped.

## Phase 4 Findings (2026-09-10) — storage-boundary deep recon

**Correction to Phase 1's framing**: the "two parallel WAL-append paths"
finding doesn't hold up under closer inspection. `createCoordinatorQueueWalStore`
(`swCoordinatorQueueWal.js`) never calls `appendWalRecordsToGeneration`
itself — it only wraps the surrounding concerns (defaults, physical-payload
assembly, metrics). There's one mutation path
(`persistCoordinatorAuthorityQueueWalMutation`/its batch sibling) that
necessarily mixes wrapped helpers with a raw primitive call because **the
wrapper's surface is incomplete, not because two competing paths exist**.
The real gap: `createCoordinatorQueueWalStore` needs an
`appendMutation()`/`appendBatchMutation()` method encapsulating the append
call plus ~150 lines of hard-limit checking, payload building, metrics, and
post-append replay-verify currently duplicated near-verbatim between the
single and batch persist functions in `sw.js`.

**The duplicated read/rebuild recipe (Pattern 7's other half)**: 12 named
functions + 2 unnamed ones in `sw.js` (full catalog with line ranges in the
recon transcript) share a byte-identical 4-line core recipe (assemble
defaults → `metricStorageGet` → WAL hydrate → WAL recover), differing only
in which fields they load. Genuinely consolidation-safe on the data-shape
axis, but two real behavioral landmines: (1) `closeRuntimeTabsReclaimedByAuthority`
is a side effect present in only 2 of ~14 sites, not a clean data toggle —
one call site (`refreshCoordinatorQueueViewForDashboard`) gets it seemingly
by accident on a dashboard-refresh path; (2) a "prefer resident authority,
skip storage if already hydrated" shortcut is independently reimplemented
in two places with different field sets, confirming this pattern
self-duplicates over time exactly as this whole audit predicts. Consolidation
risk is entirely in correctly auditing these two flags per call site, not
in the read logic itself.

**Storage call-site categorization** (~80 real `metricStorageGet`/`Set`
sites in `sw.js`, close to Phase 1's ~90 estimate): roughly 45% are simple
single-key reads/writes unrelated to WAL/sharding (fine as direct calls,
not real leakage), ~35% are "load/save projection" style operations that
duplicate the recipe above or each other (`saveProfileNukeProgressRowProjection`/
`deleteProfileNukeProgressRowProjection` share almost their entire
read-prologue), ~20% are genuinely bespoke one-offs correctly modeled as
direct calls today. The real consolidation opportunity is concentrated in
~10 distinct duplicated recipes, not spread across 30 independent sites.

**Test-coupling reassessment**: splits cleanly into two groups, not one
pile. Group 1 (~12 tests) are genuine unit tests of the storage module's
own key-derivation/corruption/migration contract — the internal key format
*is* what they test; leave these alone. Group 2 is incidental key-prefix
scanning used as a proxy for a behavioral property with no higher-level
concept to assert against yet (e.g. a "this operation only touched a
minimal state slice" guarantee, currently only expressible by listing raw
key names) — these would become clean behavioral assertions "for free" if
the read-side consolidation introduces an explicit options object to
assert on instead. One test (`'content-page projection rebuild...'`) is
purely incidental and could be rewritten today with no loss of intent.

**Three candidate designs, not a recommendation to implement any of them
now:**
- **Option A** — one parameterized `loadCoordinatorProjection(options)`
  replacing all 14 duplicates. Justified by the evidence (the recipe really
  is uniform) but requires auditing every call site's
  `reclaimRuntimeTabs`/`preferResidentAuthority` flags correctly — get it
  wrong and either leak stale tabs or introduce side effects on read-only
  paths.
- **Option B** — extract only the proven-common steps (WAL recovery,
  resident-authority shortcut) as shared helpers, keep the 12 named
  functions as thin per-site wrappers. Less code reduction, but avoids
  concentrating the flag-plumbing risk into one function's option surface.
- **Option C** — complete the `swCoordinatorQueueWal.js` wrapper (the
  `appendMutation`/`appendBatchMutation` methods from the correction
  above), independent of A/B. Closest to a pure extraction with an
  existing test safety net (Group 1's tests already assert on the
  byte-level outcomes this would preserve) — the agent doing this recon
  flagged it as the most tractable of the three on its own, without being
  asked to rank them.

No code changes made at recon time. This is design input for whenever
Phase 4 is scheduled, per the plan's original framing ("needs its own
design pass").

## Phase 4, Option C — implemented (2026-09-10)

User approved Option C now, holding Options A and B (the read-side
consolidation) for later. Implemented as a mechanical, behavior-preserving
extraction:

- `swCoordinatorQueueWal.js` gained two new functions,
  `prepareCoordinatorQueueWalAppend(storedWal, records, options)` and
  `verifyAppendedCoordinatorQueueWalReplay(append)`, encapsulating exactly
  the two chunks of logic that were byte-for-byte identical between
  `persistCoordinatorAuthorityQueueWalMutation` and its batch sibling in
  `sw.js`: the append-primitive call + physical-payload build + hard-limit
  boolean check, and the post-append replay-verify + ignored-record
  filtering. Both new functions import `appendWalRecordsToGeneration`/
  `recoverProjectedState` directly from `./swstorage` (matching this
  file's existing plain-`require` pattern for storage primitives — no new
  capability-injection surface needed).
- Deliberately scoped narrower than "everything" in the recon's
  description: diagnostic-event recording, metric-name selection, and
  reconcile/checkpoint-switch scheduling stay in each caller, since those
  differ in wording ("append" vs "batch append") and metric-name infixes
  between the two callers — extracting them would have required either
  threading scheduling capabilities into a currently-pure data module or
  papering over legitimately-different diagnostic text. The new functions
  are data-in/data-out; callers still decide what to do with a
  not-`ok` result.
- One accepted, called-out side effect: the two callers previously timed
  the append call and the physical-payload build as two separate metric
  phases (`queueWalAppendPrepare`, `queueWalPhysicalPayload`); now that
  they're one function call, both got collapsed under the
  `queueWalAppendPrepare` label. A minor loss of timing granularity, not a
  correctness change.
- Verified two real behavioral asymmetries between the single and batch
  callers were preserved exactly, not accidentally unified: the single
  mutation's extra `if(!authoritativeProjectionQueue)` diagnostic-only
  block (present only in the single-row path) and the batch-only
  `storageContext.coordinatorAuthorityQueueMutationApplied` side effect
  and shadow-WAL sync call — none of these were touched.
- Full `npm run test:parallel` green with no test changes needed at all
  (including `p1-contract.test.js`'s source-shape assertions on these two
  functions' call sites, and `swSynthetic.test.js`'s WAL segment/checkpoint
  tests that exercise this path end-to-end through real message handling)
  — strong signal the extraction is genuinely behavior-preserving, not
  just superficially passing. Rebuilt and reloaded as `1.6.1229`, zero
  manifest/runtime errors, dashboard loads cleanly.
- Options A and B (the read-side `load*` function consolidation) remain
  fully deferred, per user decision, with their tradeoffs documented above
  for whenever that work is picked up.

## Phase 6 (2026-09-10) — beyond the original 5-phase plan

No Phase 6 existed in the original plan; user asked to look past Phase 5.
Rather than invent one unprompted, presented candidates and got direction
on three:

1. **Deduplicated `isExplicitSecurityVerificationRecord`** (Pattern 6's
   remaining instance). It was tripwire-guarded in Phase 2, not yet fixed
   at the source. Now a single implementation in `jobState.js`, threaded
   into `swProfileNukeRecordClassification.js` via `deps.handlers`
   (imported into `sw.js` under an alias,
   `isExplicitSecurityVerificationRecordFromJobState`, since that module's
   own re-export of the unaliased name already occupies it in `sw.js`'s
   scope) and re-exported unchanged so no existing `sw.js` call site
   needed to change. The now-obsolete Phase 2 tripwire (which compared two
   independent function bodies) was replaced with a test asserting the
   duplication doesn't come back — the body should exist in `jobState.js`
   only, and the classification module should source it from
   `deps.handlers`. Full test suite green, rebuilt/reloaded as `1.6.1230`,
   zero runtime errors.
2. **Extending the audit's file coverage** to `coordinator.js` (the
   dashboard UI) and `popup.js`, which Phase 1's three tasks never looked
   at for any of the 8 named patterns. Recon complete, no code changes.
   Patterns 0, 1, 2, 5: none found — clean on those. Notable findings on
   the rest:
   - **Pattern 3, a visible symptom of an already-tracked gap**:
     `coordinator.js`'s `getQueueActionLabel` falls through to `'Mute
     Block'` when `actionKind` is blank — meaning the content.js
     "already-unblocked, just unmute" `actionKind`-never-set gap (fixed
     earlier tonight for the *persisted record*, but this dashboard code
     reads the same blank field) can render a reverse/unblock-unmute queue
     item mislabeled as "Mute Block" in the UI.
   - **Pattern 4**: two full-map storage overwrites in `popup.js`
     (`clearNukedPosts`, `updateSpaceCategory`) race independent
     read-merge-write cycles `sw.js` does on the same keys — medium and
     low risk respectively, narrow windows, not yet observed live.
   - **Pattern 6, confirmed drift (same severity class as the two already
     fixed tonight)**: `coordinator.js`'s own
     `isTerminalQueueStatus`/`isActiveQueueItem`/`isPendingQueueStatus`
     independently reimplement `swCoordinatorStatusRules.js`'s canonical
     versions, and coordinator.js's terminal-status list includes
     `'complete'` where the canonical `TERMINAL_JOB_STATUSES` doesn't —
     currently harmless (nothing actually emits `'complete'` in this
     pipeline) but proof the lists aren't kept in sync, feeding almost
     every render/control-sync function in the file. Also:
     `isRetryableFailedQueueItem` (coordinator.js) near-duplicates
     `isRetryableJobFailure` (jobState.js) with a whitespace-trim
     difference; `RETRY_FAILED_LIMIT = 2` duplicates a scattered literal
     default used in three places in `sw.js`; six storage-key constants
     duplicate `swdashboard.js`/`swprefs.js`'s canonical ones (currently in
     sync, lower risk). None fixed in this pass — same "needs the same
     import-instead-of-duplicate treatment already proven twice tonight"
     shape, just not yet applied here.
   - **Pattern 8**: `coordinator.js` has ten scattered inline
     `10000`/`5000` timeout literals across `sendRuntimeMessageWithTimeout`
     call sites, inconsistent with this *same file* already promoting
     other timeouts (`COORDINATOR_RESUME_INTERVAL_MS`,
     `CURRENT_WORK_MUTATION_TIMEOUT_MS`) to named constants.
3. **Making Phase 5 enforceable**, not just a doc pointer a future session
   might not read. Added a new, generic `p1-contract.test.js` test scanning
   `content.js`/`sw.js`/`jobState.js` for `SCREAMING_SNAKE_CASE` string
   constants declared as a literal in more than one file — unlike the two
   hand-written Pattern-6 tripwires earlier this session, this one doesn't
   need to know about any specific constant in advance, so it catches
   *new* duplication automatically. **Validated hard by immediately finding
   4 real, previously-unnoticed pre-existing instances** on its first run:
   `SERVICE_WORKER_QUEUE_OWNER_ID` (`'service-worker-queue-owner'`),
   `QUEUED_PROFILE_RESOLUTION_MODE` (`'author-profile'`),
   `SPACE_PENDING_NUKED_POSTS_KEY` (`'mbSpacePendingNukedPosts'`), and
   `PROFILE_NUKE_PROGRESS_VIEW_KEY` (`'mbProfileNukeProgressView'`), each
   independently declared in both `content.js` and `sw.js`. Not fixed in
   this pass — unlike the two constants fixed earlier tonight,
   `content.js` and `sw.js` don't already share a common module that owns
   these values (`jobState.js` was a ready-made home for the earlier two;
   these four would need a new or different shared home, a small design
   decision rather than a one-line import swap). Allowlisted by value in
   the new test (with a comment pointing here) so the test still catches
   any further-new duplicate while these four remain open. **Follow-up
   candidate for a future pass**: pick or create a shared constants module
   both files import from, and dedupe these four the same way
   `UNBLOCK_UNMUTE_ACTION_KIND`/`TRANSIENT_PROGRESS_STATUSES` were fixed
   earlier tonight.

Commit hygiene note: two commits landed for this session's work
(`3508304` for the bug fixes + Option C, `8fac43b` for the recurring
Windows/Cygwin executable-bit regression) before Phase 6 started. The
exec-bit issue is confirmed recurring on every `git add -A` on this
checkout, not a one-time fluke — `git config core.fileMode false` would
stop it, left for the user to decide.

### Phase 6 item 2 follow-up (2026-09-10): fixed the confirmed drift

The `isTerminalQueueStatus`/`isActiveQueueItem`/`isPendingQueueStatus`/
`isRetryableFailedQueueItem` duplication flagged above is fixed. `coordinator.js`
now requires `./jobState` and `./swCoordinatorStatusRules` and constructs the
same `createCoordinatorStatusRules` factory `sw.js` uses; the four local
functions became one-line delegations to `isTerminalCoordinatorStatus`/
`isActiveCoordinatorStatus`/`isPendingCoordinatorStatus`/
`isRetryableCoordinatorFailure` instead of re-declaring the status arrays. The
dead `'complete'` value is gone from the terminal-status check as a result
(confirmed nothing in the codebase ever emits it — the only other `'complete'`
usages are unrelated `chrome.tabs.onUpdated` `changeInfo.status` checks in
`swBootstrap.js`). `test/p1-contract.test.js`'s `loadDashboardHarness()` sandbox
had a fixed require-allowlist (`webextension-polyfill` only) left over from
when `coordinator.js` had no local requires beyond that; extended it to also
resolve `./jobState` and `./swCoordinatorStatusRules` to the real modules
(not mocks) so the sandboxed dashboard tests still exercise real status logic.
Added a new tripwire test asserting the delegation stays in place. Full
`npm run test:parallel` green with zero other test changes needed — same
strong behavior-preservation signal as the Option C wrapper work.

The `RETRY_FAILED_LIMIT` scattered-literal duplicate and the six storage-key
duplicates noted in the Phase 6 item 2 findings above are still open —
narrower, lower-severity, left for a future pass.

## Phase 4, Option B — attempted and reverted (2026-09-10)

User approved starting on Options A/B together with the symbolic timeout
registry. Attempted Option B's WAL-recovery half first (the lower-risk half
per the recon): extracted the byte-identical 5-line "hydrate WAL store from
just-read stored payload, recover queue from it" recipe shared by the 10
`load*Projection` functions (`loadCoordinatorQueueProjection` through
`loadCoordinatorQueueRunsProgressPendingNukedProjection`) into one helper,
`recoverCoordinatorQueueFromStoredProjection(stored, metricPath)`, called
from each site instead of re-declaring the recipe.
`closeRuntimeTabsReclaimedByAuthority` was deliberately left out of the
helper (its 2-of-14 call-site asymmetry, noted in the findings above, is a
real side effect, not a data-shape detail) — that part of the extraction was
correct and is not why this was reverted.

**Reverted because it broke two `swSynthetic.test.js` tests**: "executor
apply defers queued-authority enqueue when capacity is throttled" and
"executor apply defers queued-authority final open timeout despite unrelated
runtime surface", both fake-timer tests racing a queue-read-and-recover
chain against a separately-resolving queued-tab-fill promise. Root cause:
wrapping the shared recipe in its own function -- even a plain function
returning a `.then()` chain, not just `async`/`await` -- adds one extra
microtask tick between "WAL store hydrated" and "queue recovered" versus
having those two `await` statements inline in the caller's own async body.
That extra tick was enough to flip which side of a fake-timer-driven race
resolved first in these two tests. Confirmed by reverting to plain
`async`/`await` inline in a temp version, then to a `.then()`-chain
version of the helper -- both still failed the same two tests, so this
isn't an async/await-style artifact, it's inherent to introducing *any*
separate function boundary into this particular hot path.

**Why this matters beyond these two tests**: it means the "byte-identical
recipe" finding from the recon was right about the *data shape* but missed
a *timing* coupling between this read path and at least one concurrent
promise elsewhere in the executor-apply flow -- a coupling nothing in the
recipe's own text reveals, only observable through exactly this kind of
fake-timer test. Only 2 of 46 synthetic test shards caught it; a codebase
without this level of fake-timer test coverage would have shipped the
regression silently. Treat any future attempt at Option A (which touches
the same recipe, just with more call sites and a bigger option surface) as
carrying this same risk, not just the flag-auditing risk called out in the
original findings.

**Current state**: fully reverted (`git diff shared/js/sw.js` is clean
again after this attempt), full `npm run test:parallel` green. Options A
and B remain deferred, now with this additional caution attached. The
symbolic timeout registry (Pattern 8) work is unaffected and proceeds
separately.

## Phase 4, Option B — retried and landed via a sync/async split (2026-09-11)

The revert above correctly identified *that* any extra function boundary
between "WAL store hydrated" and "queue recovered" adds a microtask tick,
but not *why*: the all-async helper wrapped both the genuinely-async step
(`await loadCoordinatorQueueWalStoreFromStorage(...)`, already a call into
an existing shared function at every site) and the purely-synchronous step
after it (`recoverCoordinatorQueueFromWal(...).queue`) inside one new
`async` function. Returning from *any* async function function costs a
promise-resolution tick, independent of whether the body uses `await` or
`.then()` — that tick is what broke the race, not a stylistic choice.

**The fix**: extract only the synchronous half as a plain (non-`async`,
non-promise-returning) function, and leave each site's own
`await loadCoordinatorQueueWalStoreFromStorage(...)` inline, unchanged:

```js
function recoverQueueFromWalStore(queueSnapshot, walStore) {
    return runQueueWakeupMetricPhase('recoverQueueWal', () => recoverCoordinatorQueueFromWal(
        queueSnapshot,
        walStore
    )).queue
}
```

Each of the 10 `load*Projection` sites now reads:
```js
const walStore = await loadCoordinatorQueueWalStoreFromStorage(stored, queueSnapshot, {...})
const queue = recoverQueueFromWalStore(queueSnapshot, walStore)
```
A plain synchronous function call never yields to the microtask queue, so
this is tick-for-tick identical to the original inline code while still
giving the duplicated recipe (the part that was actually repeated 10 times)
a single definition. `closeRuntimeTabsReclaimedByAuthority` stays out of
the helper for the same reason as the first attempt (2-of-14 call-site
side effect, not a data-shape detail).

**A continuation-passing variant was also tried and empirically failed**,
worth recording so it isn't retried blind: passing the caller's
post-recovery logic in as a callback invoked from inside a shared
`.then()` (so the callback runs in the *same* promise settlement as
"walStore resolved," rather than a second caller-owned continuation after
its own `await`) was hypothesized to also avoid the extra tick. It didn't
— tested against the same two functions, it still broke the identical
fake-timer race (and one more test besides: 3 failures instead of 2).
Returning a promise from the outer `async` arrow (`return
withRecoveredCoordinatorQueue(...)`, deliberately not `await`ed) still
requires the engine to adopt it as a thenable, which costs its own tick
regardless of the `await`-vs-`.then()` styling. **The generalizable lesson**:
in this specific hot path, the only change that is provably tick-neutral is
one where the shared extraction contains zero `async` functions and zero
promise-returning functions in the call chain between the caller's
existing `await` and its next synchronous statement — sync/async
boundaries matter, not code style.

Verified against both previously-failing tests directly, then the full
`npm run test:parallel` (all 46 synthetic shards, contract, unit, wal,
scenario, lint) — fully green, zero other test changes needed.

## Pattern 8 — symbolic timeout registry, built (2026-09-10)

User explicitly triggered this (overriding the reactive-only policy in
[[feedback-symbolic-timeout-registry]] project memory) after the Option B
revert, choosing the full-build option over a minimal single-bug seed.

New module `shared/js/timeouts.js` exports named `*_MS` constants, one per
wait-loop function's own default parameter value (not deduplicated by
number -- two waits sharing a value today aren't necessarily the same kind
of wait, so each keeps an independently-tunable name). Scope, precisely:

- **content.js** (14 functions): `waitForAction`, `waitForCondition`,
  `waitForConditionOrDomMutation`, `waitForMenuState` (and its
  `WithForegroundFallback` sibling's options default), `readProfileMenuState`,
  `waitForProfileMenuState`, `ensureProfileMenuOpen`,
  `waitForVerifiedProfileUnblocked`, `waitForVerifiedProfileBlocked`,
  `waitForProfileActionReady`, `waitForCanonicalProfileActionRoute`,
  `waitForOwnedNukeTabsToDrain`, `closeProfileMenu`,
  `safeSendRuntimeMessageWithTimeout`.
- **coordinator.js**: `sendRuntimeMessageWithTimeout`'s own default, plus
  its 9 explicit call-site overrides (6× the `10000` mutation-timeout
  literal, 3× a redundant explicit `5000` matching the default) collapsed
  onto two named constants, `COORDINATOR_MESSAGE_DEFAULT_TIMEOUT_MS`/
  `COORDINATOR_MESSAGE_MUTATION_TIMEOUT_MS`.
- **sw.js**: one stray instance found while grepping for the pattern,
  `waitForUserStartDurableActivation`'s `timeoutMs = 15000` default --
  everything else in sw.js already used named constants (`sendRuntimeMessage
  WithTimeout`-style helpers weren't the norm there).

**Deliberately out of scope**: the much larger set of explicit per-call-site
`waitFor*(..., customTimeoutMs, customIntervalMs)` overrides in content.js
(dozens of one-off calls) -- these stay scattered literals, migrated
opportunistically as each is independently touched, per the original
memory note's own migration plan. Forcing every one-off number into a
uniquely-named, never-reused constant now would relabel entropy rather than
reduce it; the function defaults are the real shared "dial" every
unspecified call site inherits.

**Risk profile, contrasted with the Option B revert above**: this is a pure
value-for-name substitution at the exact same call-site position -- no new
function-call boundaries, no new `await` points, no control-flow change, so
none of Option B's microtask-timing risk applies. Confirmed by the full
`npm run test:parallel` run: all 46 synthetic fake-timer shards passed
unchanged (the class of test that caught the Option B regression), plus
`p1-contract`'s two `extractFunction`-based signature-anchor tests updated
to match the new parameter text. Added a new generic tripwire, `'wait-loop
functions in content.js/coordinator.js/sw.js use named timeouts.js
constants, not bare numeric defaults'`, scanning all three files for any
`timeoutMs`/`intervalMs` bare-literal default -- catches regressions and
any new wait-loop function added later without a registry entry.

Rebuilt as `1.6.1231` (`npm run prod` and `npm run build:chrome-dev` both
green); no live CDP smoke test performed this pass -- no Chrome debug
session was running at the time, and the change's risk profile (proven
value-identical substitution, not a control-flow change) didn't seem to
warrant starting one solely for this. Worth a live check next time a
Chrome-dev session is up anyway.

## Live-testing find: profile button insertion delay (2026-09-11)

Not from the audit -- found during live testing on the freshly-built
`1.6.1232` extension. User reported the mute/block buttons taking a
noticeably long time (~8s observed) to appear on profile pages.

**Root-caused with a live trace, not guesswork.** Injected temporary
`console.log` checkpoints through `content.js`'s `init()` and `sw.js`'s
`getContentPageCoordinatorState`/`rebuildContentPageStateProjectionFromCurrentState`,
rebuilt, reloaded, and captured real timestamps from a fresh page reload
(both from the content-script side and the service-worker side). Confirmed
via direct DOM-timing trace on two different profiles (one banned, one not
-- ruling out "banned account" as a special case) that the delay was
consistently ~6.6-6.8s, and via the injected checkpoints that Quora's own
profile-menu DOM was already present (`ensureProfileButtons called
(hasTarget=true)`) by the time our own code finally got around to trying --
our own code just hadn't tried yet.

**The actual cause**: `content.js`'s `init()` runs its entire page-load
sequence -- four `chrome.storage.local` reads, `refreshCoordinatorQueueFromRuntime`
(a runtime message to the service worker, wrapped in its own 3000ms
timeout), a possible re-save, and `reconcileReloadCanceledNukes()` -- fully
sequentially and fully `await`ed *before* ever calling `ensureProfileButtons()`
for the first time on a profile page. None of that work is a real
dependency of button insertion: `toggleMuteBlockBtn`/`toggleUnblockUnmuteBtn`/
`injectCloseTabBtn` only read `isProfileBlocked()` and the page's own DOM
(`getProfileButtonInsertionTarget()`), never `settings`, `coordinatorQueue`,
or `profileNukeProgress`. The two `syncProfileButtons()` callees that *do*
touch coordinator state (`maybeRecordAlreadyBlockedCoordinatorProfile`,
`nudgeCurrentProfilePendingClaim`) either do their own scoped refresh or are
harmlessly re-invoked by `ensureProfileButtons`'s own retry/follow-up cycle
once the queue arrives -- so nothing breaks if button insertion fires
before that slower chain completes.

Live-session note, not part of the fix itself: under this session's heavy
CDP-testing load, individual `chrome.storage.local` operations and runtime
messages were themselves observed taking many seconds (once even 30+
seconds on a raw, un-timeout-wrapped `chrome.runtime.sendMessage`) --
likely contention from the volume of manual testing/reloading this session,
not a data-volume problem (the actual on-disk `chrome.storage.local`
backing store for this profile is only ~2.7MB). This wasn't chased to a
root cause tonight since it didn't require a code change; the button-timing
fix below is unaffected by it either way -- it removes a *self-imposed*
sequential dependency regardless of how fast or slow the underlying storage
happens to be on a given machine.

**The fix**: in `content.js`'s `init()`, moved `maybeRedirectToCanonicalProfileUrl()`
(pure URL/DOM check, no dependency on the slow chain either) and the
`initialPage === 'profile'` branch's `ensureProfileButtons()`/
`scheduleProfileButtonsFollowUps()` calls to fire immediately after
page-type detection, *before* the settings/coordinator-queue/
reconcile-canceled-nukes sequence, instead of after it. The other page
types' dispatch (question, question-log, space-post, space, profile-search)
were deliberately left in their original position -- the user's reported
symptom was specific to profile pages, and reordering those too would be
unvalidated scope creep. Checked all 5 of `p1-contract.test.js`'s existing
`init()`-body ordering assertions before making the change; none depend on
the relative position being moved, all still hold.

**Verified with a live before/after trace**: same DOM-timing methodology as
the initial diagnosis. Fred Waterford's profile: 6701ms -> 192ms. Awakening's
profile: 6641ms -> 0ms (button already present at the instant of injection).
Full `npm run test:parallel` green both before and after. Rebuilt/reloaded
live at `1.6.1235`; `chrome.management` reload report showed 0 manifest/
runtime errors both times.

## Phase 7 (2026-09-12/13) — coordinator queue stability incident, and a new named pattern

Live-testing incident, not from the audit. A CPU-storm/duplicate-tab crisis
(carried over from an earlier session) turned out to have several
compounding root causes, all instances of one new pattern worth naming
alongside the five in the "Named patterns" section above:

**9. Global recompute where the call site only changed one thing.** A
function takes the whole authority state / queue / progress map as input and
does a full deep clone, full JSON stringify, or full `Object.entries` scan
of all of it, even though the caller changed (or wants) exactly one row.
Cheap at test scale, silently O(total accumulated rows) at real scale --
and because "total accumulated rows" only grows over a long session, code
that was fine in every unit test can still degrade over hours of live use.
Two confirmed, fixed instances this session:

- `applyWalRecord` (`walSnapshotStore.js`) called `cloneJson(state)` --
  a full `JSON.stringify`/`parse` round-trip of the entire authority state
  -- on every single WAL record application, even though every branch only
  ever replaces one `area`/row wholesale. Replaying N records against a
  queue that has accumulated hundreds of already-terminal rows cost
  O(N * totalQueueSize), not O(N). Fixed: shallow copy (`{...state}`);
  every branch already does proper copy-on-write at the area/row level, so
  nothing deeper was needed. Regression test:
  `test/walSnapshotStore.test.js`, "applyWalRecord shallow-copies state
  instead of deep-cloning untouched rows and areas" (asserts object
  identity survives for untouched rows/areas).
- `absorbPersistedSnapshot` (`sw.js`) called
  `makeCoordinatorAuthorityProjection(projection)` -- a full 5-way deep
  clone of stored/queue/runs/events/progress via the hand-rolled recursive
  `cloneCoordinatorAuthorityValue` -- unconditionally at the top, before
  even checking whether the incoming payload touched anything relevant.
  This function runs on *every* `chrome.storage.local.set()` call
  extension-wide (via `metricStorageSet` ->
  `notifyCoordinatorAuthorityPersistedSnapshot`), so most calls paid the
  full clone for nothing. Fixed: shallow copy of `stored` (the only field
  ever mutated key-by-key in place) plus shared references for
  queue/runs/events/progress (every branch only ever reassigns those
  wholesale, never mutates nested contents).

Two more compounding bugs in the same incident, not instances of pattern 9
but worth recording here since they hit the same code paths:

- `getRetiredCoordinatorQueueWalPhysicalKeys` (`swCoordinatorQueueWal.js`)
  excluded the just-retired generation from physical-key cleanup on every
  checkpoint switch (an inverted condition -- it should exclude only the
  *new* active generation), permanently orphaning that generation's WAL
  segments in storage on every single switch, forever. Compounded with the
  checkpoint-switch itself deferring indefinitely whenever the queue had any
  active/queued work (which a long-running batch always does), this drove
  `chrome.storage.local` to its 10MB default quota, at which point writes
  started failing outright. Fixed the inverted condition; added a
  `COORDINATOR_QUEUE_WAL_SEGMENT_FORCE_SWITCH_AT` knob so the switch forces
  through once growth clearly outruns normal amortization instead of
  deferring forever; added `unlimitedStorage` plus a self-imposed 100MB soft
  quota with an 80% early-warning diagnostic event (`swflightRecorder.js`
  gained `close-if-blocked-sent`/`close-if-blocked-response` kinds and
  `sw.js` gained `maybeCheckCoordinatorStorageQuotaHealth`), so a future
  leak surfaces long before it becomes an outage.
- `content.js`'s queued-action claim loop (`maybeRunAutoProfileAction`)
  waited on `coordinatorQueueLoaded` becoming `true` but never retried the
  sync (`refreshContentPageCoordinatorStateFromRuntime`) that sets it --
  that sync runs exactly once, in `init()`, with a 3s budget. If the SW was
  busy at that exact moment (e.g. mid-reconcile of a large backlog),
  `coordinatorQueueLoaded` stayed `false` for the rest of that page's life
  and the queued action was never claimed or attempted -- while unrelated
  message handlers (`close-if-blocked`) kept responding normally, since they
  don't depend on this flag, masking the failure. Fixed: the retry branch
  now re-kicks the sync each cycle (it has its own throttle/dedup, so this
  is safe). Not confirmed against a live reproduction of the original
  symptom -- shipped on the strength of the code-level diagnosis and
  existing/new contract-test coverage, not a live before/after trace.

All of the above: full regression-test coverage added, `npm run
test:parallel` green. Shipped as `1.6.1236` through `1.6.1242`.

### Audit: other likely instances of pattern 9, not yet investigated

Prompted by the two confirmed instances above, a grep sweep across
`shared/js/` for the same shape (a function taking the full `queue`/
authority-state object and doing `Object.entries`/`Object.values`/
`Object.keys` over all of it, a full `JSON.stringify`/`cloneJson`, or a
`hashState`/`stableStringify` pass) turned up a much larger surface. None of
these are confirmed bugs -- they may well be fine, especially if the queue
argument at that call site is already a small scoped subset rather than the
full authoritative map, or if the call site itself is inherently rare
(a one-off dashboard button, not a per-tick path). Each needs its own
"is this actually hot, and is `queue` actually large here" check before
deciding whether it's worth fixing. This list is meant to be split across
agents -- one agent per file (or small file group) is a reasonable unit of
work, since each file's hits share the same module and the same `queue`
plumbing.

**Not yet audited, in priority order (highest suspected hotness first):**

1. **`coordinatorAuthority.current()`** (`sw.js:7520`) -- calls
   `makeCoordinatorAuthorityProjection(projection)`, the exact same full
   5-way deep clone fixed in `absorbPersistedSnapshot` above, on *every*
   call, unconditionally. 112 direct call sites in `sw.js` plus 31 more via
   the `getHydratedCoordinatorAuthorityState` wrapper. This is the single
   largest remaining suspect: same shape as a confirmed bug, much bigger
   blast radius. Fixing it safely requires auditing call sites for any that
   rely on the clone for mutation isolation (i.e. mutate the returned object
   expecting the resident state to be unaffected) before switching to a
   shared reference or a cheaper copy.
2. **`hashState`/`stableStringify`** (`walSnapshotStore.js:48-51`, used at
   `:293` inside `decodeCheckpointSnapshot` and `:863` inside
   `projectSnapshot`) -- a hand-rolled recursive stringify that sorts keys
   at *every* nesting level (more expensive than plain `JSON.stringify`),
   run over the *entire* resulting state on every WAL replay and every
   checkpoint load/verify. Stacks on top of the replay cost already fixed
   in `applyWalRecord`. Worth checking whether this can be skipped when the
   caller doesn't need integrity verification, or memoized against a
   "nothing changed since last hash" flag.
3. **`runCoordinatorExecutorApplyPhase`** (`sw.js:14973`) -- full
   `Object.entries(queue)` scan (`queueProfileHrefs = Object.entries(queue
   || {})` at :14973) in what is very likely the single hottest path in the
   whole coordinator (the executor's own per-tick apply phase).
4. **`runCoordinatorAuthorityReconcileActions`** (`sw.js:4545`) and
   **`applyCoordinatorReconcileQueueAuthorityTransitionPhase`**
   (`sw.js:8706`) -- full queue scans in the reconcile tick, which runs
   reactively/periodically, not just on user action.
5. **`recoverPendingTabActionFromCoordinatorQueue`** (`sw.js:27012`) --
   the claim-recovery path investigated live this session (see the
   `coordinatorQueueLoaded` fix above): a full linear scan over the whole
   queue with an `await coordinatorItemMatchesTab(...)` per row, to find one
   tab's match. `coordinatorItemMatchesTab` itself fast-rejects terminal
   rows cheaply, so this is likely fine at current scale, but it's an
   unindexed O(queue size) scan on a path that's already been implicated in
   one live incident.
6. **`getOwnedNukeStatus`** (`sw.js:26451`) -- frequency not yet checked;
   do that first before deciding if the full scan here matters.
7. **`swqueueRuntime.js`'s `getOrderedQueueItems`/`rebuildQueueOrder`**
   (`:501`, `:532`) -- these are the *intended* fix for exactly this pattern
   (an incrementally-maintained ordered index, rebuilt only when
   `refreshResidentCoordinatorAuthorityState` determines the state actually
   changed) -- but only 3 of the ~50 raw-scan call sites in this list
   actually go through them (`sw.js:4499`, `:12910`, `:15189`). Worth
   checking whether more of the hot ones below could route through this
   instead of re-deriving their own scan.
8. **`swCoordinatorReconcileInputs.js`**: `getCoordinatorQueueWorkCounts`
   (`:107`, called from 17 sites in `sw.js` per an earlier grep) and
   `getCoordinatorAuthorityMismatchCounts` (`:123`) -- both full scans,
   used throughout reconcile/scheduling decisions.
9. **`swQueuedTabMetadataAndActionLease.js`**: `clearExpiredCoordinatorActionLeases`
   (`:229`), `findActiveCoordinatorActionLease` (`:249`),
   `findCoordinatorStoredWorkCancelTarget` (`:284`) -- lease bookkeeping is
   plausibly on a hot-ish path (every queued tab action touches a lease);
   the cancel-target one is likely rare (user-triggered cancel).
10. **`swCoordinatorQueueView.js`** (5 hits: `:110`, `:148`, `:254`,
    `:312`\*2) -- `summarizeCoordinatorActualBlockTiming`,
    `summarizeCoordinatorActivationHandoffTiming`,
    `filterCoordinatorQueueForCompactView`,
    `makeCoordinatorQueueAccountingCounts` -- this module builds the
    dashboard's queue view; several of these run from the write/persist
    path (`buildCoordinatorQueueView`, 6 call sites in `sw.js`, some inside
    `persistCoordinatorAuthorityQueueWalMutation`'s write path), not just
    on-demand dashboard reads.
11. **`swCoordinatorRuns.js`** (3 hits: `:93`, `:141`, `:170`) --
    `materializeCoordinatorRunsPausedStateFromControl`,
    `getCoordinatorRunItems`, `recomputeCoordinatorRuns` -- likely bounded
    by run count rather than queue count in practice, but each iterates the
    full `queue` to find rows belonging to a run rather than maintaining a
    per-run index.
12. **Remaining single-hit files, likely lower priority / more clearly
    bounded or rare, but not checked**: `jobState.js:254`
    (`getNextCoordinatorQueueSequence`, already small/cheap by design --
    just a max-scan), `swCoordinatorContentQueueIndex.js` (`:91`, `:107`,
    `:188`), `swCoordinatorExecutorClassification.js:110`
    (`findCoordinatorQueueEntryForHref` -- single-href lookup, called
    per-tab-action so plausibly hot despite being "just a find"),
    `swCoordinatorProgressRules.js:274` (`pruneCoordinatorCurrentWork`),
    `swCoordinatorRetryCandidates.js:116`
    (`getCoordinatorRetryableFailureCandidates`),
    `swCoordinatorSourceProvenance.js:233`
    (`getCoordinatorQueueProfileHrefSet`),
    `swCoordinatorTerminalSettlement.js:125`
    (`getCoordinatorTerminalItemEntries`), `swProfileNukeProgress.js:252`
    (`hasNonterminalCoordinatorAuthorityForProfile`),
    `swQueuedForegroundLeaseRuntime.js:161`
    (`restoreQueuedTabRuntimeFromActiveAuthorityForSender`),
    `swQueuedRuntimeActionMatching.js:143`
    (`getQueuedRuntimeActionAuthorityEntry`),
    `swQueuedTabDetachSurfaceDedupe.js:162`
    (`findAuthorityTabIdForRuntimeSurface`),
    `swQueuedTabRuntimeStatus.js:393`
    (`hasDurableQueueMatchForRuntimeTab`),
    `swQueuedWorkerActionSurfaceState.js:160`
    (`hasDurableQueuedBacklogForActionSurface`),
    `swSchedulerAlarmBookkeeping.js:274` (`hasStoredCoordinatorWork` --
    note this one can short-circuit via `.some()`, so it's not
    necessarily a full scan in practice).

**Two more categories from the same sweep, not yet broken out by call site:**

- **Storage-metrics serialization tax**: `getJsonByteSize`
  (`swStorageMetrics.js:89`, `JSON.stringify` + `TextEncoder.encode`) is
  called from `recordStoragePayloadMetrics`/`recordStorageReadPayloadMetrics`
  on every key of every storage read/write, purely to produce byte-size
  counters (16 call sites total between `sw.js` and `swStorageMetrics.js`).
  If the queue or queue-view is part of that payload -- which it often is --
  every operation pays a second full serialization solely for
  instrumentation, on top of whatever the real read/write needed.
- **`sw.js:19301`**: `JSON.stringify(normalizedQueue) !== JSON.stringify(
  pruneAuthorityState.queue || {})` -- a genuine full-queue comparison.
  Stands out because a broader sweep of the ~30 other
  `JSON.stringify(x) !== JSON.stringify(y)` patterns in `sw.js` found all of
  them comparing a single row, a single record field, or the small `runs`
  map (bounded, and fine by the same reasoning as pattern 9's exception
  case) -- this is the one outlier that compares the whole queue.

**Checked and ruled out** (small/bounded, not instances of pattern 9):
`decodeCheckpointSnapshot`'s `JSON.parse` of the checkpoint itself
(necessary, bounded by checkpoint size, which the checkpoint-switch fix
keeps bounded); `sharedModeration.js`'s `cloneJson`/`stableStringify`/block
parsing (operates on individual per-post moderation blocks, not coordinator
state); `content.js`'s per-button dataset `JSON.stringify`/`parse` calls;
the ~30 single-row/single-field `JSON.stringify` comparisons in `sw.js`
noted above.

## Phase 7 audit results (2026-09-13) — five parallel agents run down the list

The priority list above was split across five worktree-isolated background
agents, one per numbered group, each instructed to verify real hotness
before touching anything and only land a fix backed by a regression test.
Consolidated into `main` after independent review of each worktree's diff;
`npm run test:parallel` green after merging all of them together.

**Fixed:**
- **`coordinatorAuthority.current()`** (priority #1, the biggest suspect):
  confirmed the same O(total-queue-size)-per-call shape as
  `absorbPersistedSnapshot`, across ~143 call sites. Found one genuine
  blocker first: `test/swSynthetic.test.js` had a test relying on `current()`
  returning an isolated deep clone (mutating the result and asserting the
  resident state was unaffected). User decision: narrow the contract rather
  than add `Object.freeze()`/locking to preserve it (see
  [[feedback-no-freeze-lock-patterns]]) — switched `current()` to a shallow
  copy, updated that one test to assert the new (correct) shared-reference
  behavior instead, documented the narrowed contract in a comment on
  `current()` itself.
- **`getOrderedQueueItems`** (priority #7): turned out to be doing *more*
  work than the raw scan it was meant to replace — the cached-order walk
  plus an unconditional second full `Object.entries(queue)` fallback pass,
  every call. Added a fast path that skips the second pass when the index is
  already fully fresh, benefiting its 3 existing call sites (including the
  executor's hot apply/classify phases) for free.
- **`hashState` in `projectSnapshot`** (priority #2, WAL replay/checkpoint
  hashing): confirmed write-only — computed on every WAL replay and
  checkpoint switch, read by nothing anywhere in the codebase. Removed.
  The *load-bearing* hash use (`verifyCheckpoint`'s corruption check on
  checkpoint activation/recovery) is a separate code path and was left
  untouched, with its own fuzz coverage.
- **Storage-metrics duplicate serialization**: `metricStorageSet` (wraps
  every `chrome.storage.local.set()` extension-wide) called two metrics
  functions back-to-back that each independently ran a full
  `JSON.stringify` over the queue when present. Added a reference-keyed
  handoff cache so the byte/row count is computed once and reused, falling
  back to a fresh computation on any cache miss — no call-site signature
  changes, identical metric output.
- **`getOwnedNukeStatus`** (priority #4): confirmed genuinely hot — polled
  once per second for up to 180s by `content.js` during any active nuke run
  — and found it was doing a full `chrome.storage.local` read + WAL replay
  on *every* poll instead of reusing already-hydrated resident authority
  state, unlike sibling functions that already prefer the resident state.
  Fixed by adopting that same precedented pattern.
- **`sw.js`'s full-queue `JSON.stringify` comparison** (the one outlier
  among ~30 otherwise-bounded comparisons, inside the periodic/scheduled
  reconcile tick): replaced with a per-row structural-equality check with a
  same-reference fast path and early exit on first real difference, proven
  equivalent to the old double-stringify via direct tests.
- **Priority #10** (`buildCoordinatorQueueDerivedProjectionPayload`'s 3-pass
  rebuild defaulting on for ~25 of ~37 WAL-mutation call sites) — this one
  was found independently by the queue-view/long-tail agent and fixed via a
  separately-spawned background task; full write-up is in its own section
  above ("Pattern 9 priority item #10").

**Confirmed fine / correctly not fixed** (reported with reasoning rather
than forced): `getCoordinatorQueueWorkCounts` (17 call sites, genuinely hot,
but a real fix needs incremental counters, not a scan-order swap — bigger
change than in scope), `getCoordinatorAuthorityMismatchCounts` (working as
designed; converting its scan order would be a real behavior change since
it intentionally evaluates rows in a budget-limited pass), `findActiveCoordinatorActionLease`
(hot-ish, but the real fix is a maintained index, not an ordering change),
`findCoordinatorStoredWorkCancelTarget` (rare, user-triggered, fine),
`runCoordinatorAuthorityReconcileActions`/`applyCoordinatorReconcileQueueAuthorityTransitionPhase`
(the reconcile-transition-phase one turned out to be gated to user-initiated
dashboard requests only, not periodic as suspected; the reconcile-actions
scan has a synchronous per-row early-exit cheap enough not to be worth
restructuring), `recoverPendingTabActionFromCoordinatorQueue` (confirmed NOT
periodic — only reached via tab-scoped recovery gated on "no existing
runtime state," with the row-matching helpers already fast-rejecting
terminal rows before any `await`), `swCoordinatorRuns.js`'s three functions
(bounded by scoped `affectedRunIds` in the vast majority of call sites; the
`recomputeAllRuns: true` reconcile path is a real `O(runCount × queueSize)`
exception, and `runs` entries are never pruned/GC'd — worth a future look if
run count ever grows unboundedly, not confirmed hot today), and all ~13
single-hit long-tail files from priority #12 (each individually triaged —
direct-key fast paths, `.some()` short-circuits, or genuinely rare/gated
call sites; one has the worst theoretical shape found,
`O(progressRecords × queueSize)`, but its only path in is a rare
missing-projection repair fallback, not a live hot path).

**Dead code found, not acted on** (a decision, not a perf fix):
`clearExpiredCoordinatorActionLeases` has zero callers anywhere in the
codebase — destructured but never invoked. Flagged for a human to decide
whether to wire it up or remove it.

**Environment note for future worktree-isolated agents on this repo**: all
five agents' assigned worktrees started stale (checked out at ancestor
commits hundreds of commits behind `main`, missing the very files each
assignment referenced) and had to self-repair by fast-forwarding to `main`
before they could do anything — worth refreshing the worktree pool before
spinning up the next batch, to avoid spending agent budget on repo
archaeology instead of the actual audit.
