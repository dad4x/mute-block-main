# Unified store build plan, nuked and pending maps first (20 Oct 2026)

> **Status: HISTORICAL** (24 Oct 2026). Shipped in 1.6.1437: nuked and pending maps stored as 32 buckets each. The rest of the unified store is superseded by the 25 Oct plan. Kept as a record. Do not implement from it. planning.md is the front door. Register: [notes register](../docs/notes-register.md).

Owner instruction: "go with the defaults and the nuked and pending maps first". Basis: unified-store-design.md (section 14, A3-A23) and pending-staging-design.md (C2-C15).

## Status

- **Shipped in 1.6.1437 (commit dd46761, tag v1.6.1437, loaded in the dev browser).** The two maps are stored as 32 hash buckets each (`mbSpaceNukedPosts.b00`..`b1f`, `mbSpacePendingNukedPosts.b00`..`b1f`), the same shape as the progress shards. A write sends only the buckets whose content changed. The layout marker `mbSpaceMapLayoutVersion` = 2 says the buckets are the truth.
- **Migration, done on the dev profile.** One write at startup of about 4.1 MB, both maps, marker included (flight recorder: `spaceMap.migrate`, saved). After it, the buckets hold 2,727 nuked and 3,327 pending entries, the same as the legacy keys. Nothing was deleted: the legacy keys are kept for rollback (A23a). Deleting them needs your approval.
- **Deviation from the design.** Day shards (A4, A6, A11) were replaced by hash buckets. Reason: a day layout needs an index key to find the days on read, and the buckets need none; the progress shards already work this way; and the write cost is the same, about one bucket per changed post. The window and cap are applied per entry, as before (A7, A14).
- **Measured.** The migration wrote about 4.1 MB for both maps. A bucket is about 65 KB, so a settlement should write about 65 to 130 KB, against about 4 MB before. This is an estimate until a settlement runs (the queue is paused now).
- **Removed.** The phase-0 day-shard module and its test. Nothing used them.
- **Tests.** Layout helpers (8 cases) and worker behaviour (3: migration keeps the legacy keys; a change writes one bucket and no whole-map key; a restart reads the same maps). Full suite: 1,259 ok, 0 not ok. Five lints and the duplicate check (41, unchanged) pass.
- **Readers updated.** Content script, popup, and the dashboard's history list read the layout keys and re-read both maps on any change to them.
- **Not done.**
  - The pending staging semantics (C2 to C5, C12, C13, C14): the click-to-enqueue path, lost-click cases and the content state route. This release only changes how the maps are stored, not how they are filled. Those choices change behaviour and need their own pass.
  - The dev diagnostics under `tools/cdp` (inspect-space-state, space-summary, storage-read-profile, upgrade-regression, wal-snapshot-benchmark) still read the legacy keys, so they show the pre-migration copy.
  - A16 decided by the owner, 20 Oct: "clear means clear". Clear keeps deleting history. No change to Clear.
  - C9 and C10 are not needed for this release, since nothing is dropped. They still block any later step that drops records.

## Defaults chosen

Unified-store design (A-items), per the recommendations given to the owner:

| Item | Default |
|---|---|
| A3 entry content | full row for profile entries; summary only where needed |
| A4 entry key | one entry per post, plus a profile index for dedupe |
| A5 updated entries after seal | seal post entries only at settle; open posts stay in the current shard |
| A6 prune | whole oldest day shards (implemented in phase 0) |
| A7 window and cap | follow the user's existing settings (30 days, 10,000) — OWNER CONFIRMED by "defaults" |
| A8 age clock | last update, for dedupe and nuked view alike |
| A9 hash | FNV-1a over the uncompressed entries (implemented) |
| A10 bad shard | ignore and count (implemented: reported in `ignored`) |
| A11 seal trigger | day roll |
| A12 lifetime counters | inside the WAL append that carries the terminal row (later phase) |
| A13 per-run counts | computed from entries at read time, not stored |
| A14 window at lookup | filter by age at lookup, one clock |
| A15 requeue from history | same window — OWNER CONFIRMED by "defaults" |
| A16 Clear marker | decided by the owner (20 Oct): Clear keeps deleting history, no change |
| A17 progress-only success | profile entry only, until candidate lists reach the rows |
| A18 history paging | keyset on last update, then key |
| A19 dashboard aggregates | scan the window first (no counters yet) |
| A20 content nuked check | message per scan, after a latency check (no session read by content) |
| A21 converted nuked records | treat as succeeded and blocked (written only when confirmed) |
| A22 rows older than 30 days at migration | keep until the first prune |
| A23 rollback | keep the old keys for one release |

Pending records (C-items), my proposal, not yet confirmed:

| Item | Proposal |
|---|---|
| C2 request shape | one message carrying the run's candidates and items |
| C3 removal signal | the enqueue result's durable flag, checked in the worker |
| C4 eviction after staging | replay the enqueue from staging at startup (enqueue is idempotent) |
| C5 enqueue not durable | keep staging and retry with backoff |
| C6 stage unit | whole run |
| C7 30-day succeeded rule | reuse the nuked-map retention for now |
| C8 candidate list | the original queueable list before clears |
| C11 rollback | keep the old key untouched and unread for one release |
| C12 content state | per-post answer in the existing state message (no session read) |
| C13 access | keep content on the state message; no session read; Firefox question not needed |
| C14 action gate | add the new action to the authority gate list |
| C15 staging size | cap by bytes, checked on write; quota to be measured first |

## Owner calls still open (block the migration, not the next phases)

- **C9.** The 95 finished-but-not-succeeded candidate links: (a) count as cleared, no history (today's behaviour); (b) a history entry with a partial outcome; (c) keep the post in progress.
- **C10.** The 18 empty pending records (your question): (a) drop all, as decided; (b) drop those with no resolver pending; (c) keep the resolver-pending ones.
- **C11 waiver.** Only if (c) copy-to-legacy is chosen; the default (b) needs no waiver.
- **A16.** Clear: hide history instead of deleting it, with a stored cutoff. Visible change; needs yes or no.

## Phases after phase 0

1. Write side: the nuked and pending writes go to the day-shard store through the door, with WAL marker. Settlement no longer rewrites either whole map. Guard test: no whole-map write of these keys.
2. Reads: enqueue, requeue, clear and the content state message read the window; content gets its per-post answer from the state message.
3. Migration: marker, dry run on a copy, then the live run. Blocked on C9 and C10.
4. Measure: bytes per settlement before and after (the baseline is about 127 MB of the 195 MB in the five-minute run).
5. Release: version bump, rebuild, commit, tag. Live switch needs the owner's go.
