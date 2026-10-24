# Completed-work log: own WAL, compressed time shards, row cap, in-memory profile index

Status: plan, not built. Written 25 Oct 2026, updated with the owner's decisions below.

## Why

The completed-work log is the `completed` area of the queue WAL. It holds every terminal row
(one per profile, by row key). Today:

- It is one map. Checkpoints split it into 10 shards by a hash of the key (walSnapshotStore.js,
  `partitionCheckpointState`), so every checkpoint rewrites all completed rows.
- Nothing bounds it. There is no age or size limit, so it grows without limit.
- Dropping old rows one at a time means one removal record per row through the write door, which
  is expensive and fights the layout.

## Owner decisions

1. **Scope of history:** any terminal result. History and the completed log are the same set of
   profiles. History is displayed from the completed log, keyed by profile.
2. **Limits, counted in rows:** the recent-history retention (90 days, `nukedPostRetentionDays`)
   and the row cap (10,000, `maxRememberedNukedPosts`). The limit is meant to be read as rows.
3. **Shards sized by I/O:** a shard is sealed at about one write band (16 KB). The time boundaries
   are loose: a shard is dropped as a whole, so some expiries drop more time than others.
4. **Clear is harmless:** clearing history removes only local memory. A re-done profile can cost a
   duplicate check, nothing else. So deleting old rows is acceptable.
5. **Storage clear:** the owner clears storage with the change, so there is no migration.
6. **Own WAL:** the completed log has its own WAL, separate from the queue WAL. The queue WAL no
   longer carries completed records.
7. **Compress the shards:** a shard is stored compressed.
8. **Re-offered profiles are fine:** a profile whose row has aged out is offered again and is
   processed quickly as already blocked. That cost is accepted.

## Design

### The WAL is a buffer

- The completed WAL is append-only and implicitly **time ordered**: each record is a terminal row or
  a removal, appended in the order it happened.
- Its job is to cut the number of shard writes. An archive appends one small record to the WAL. The
  WAL is not a unit of storage or of expiry.
- When the WAL holds about 16 KB of records (the flush threshold), its records are written out as
  one or more **time shards**, then the WAL is cleared. A shard is a contiguous run of WAL records in
  time order.

### Shards

- A shard is one storage key, `mbCompletedLogShard.<seq>` (sequence, zero-padded), holding a run of
  records in time order, **compressed** (gzip through the same codec hook the WAL engine uses).
- Shards are never changed after they are written. Removals are not applied to them in place (see
  below).
- A small **meta record** (`mbCompletedLogMeta`) lists the shards: sequence, first and last terminal
  time, row count, stored bytes. It is rewritten on each flush and each drop.
- The flush writes the new shard and the meta record, then clears the WAL. The WAL is cleared only
  after both are written, so a crash between them loses nothing: the WAL still holds the records,
  and a restart replays it.

### Writes

- An archive appends to the WAL: a small write, not a rewrite of the log.
- A flush, every ~16 KB of WAL, writes one compressed shard plus the meta record.
- A removal (requeue reviving an archived row) appends a removal record to the WAL. It is applied to
  the index at once. The stored shard keeps the row until the shard is dropped, and the index hides
  it. This avoids rewriting a sealed shard for a removal.

### Limits

- **Retention:** a shard whose last terminal time is older than the cutoff is dropped whole. Rows in
  it that are newer than the cutoff go with it. This is the loose part, by design.
- **Cap:** when the total row count is over 10,000, the oldest shards are dropped until the count is
  at or under the cap. Again whole shards.
- Both checks run after a flush and at startup. They touch only the meta record and the dropped
  shard keys.

### In-memory index

- Keyed by **profile href**. Each entry points at the row and its shard sequence (or the WAL, for a
  row not yet flushed).
- Built at hydrate from the meta record and the shards, then replayed from the WAL, then kept up to
  date by archive, removal and drop.
- Serves: the dashboard completed rows, the History list, the duplicate check
  (`findCompletedWorkRowByKey`), and the "already done" settlement the content script reads.
- The resident completed map that exists today is the same idea; it becomes the index.

### Clear

- Clear history drops every shard, empties the WAL, and resets the meta record. No per-row work.

## Reuse

- The existing WAL engine (`walSnapshotStore.js`) already has a codec hook (`codec` with
  `compress`/`decompress`) and key conventions. The completed WAL and its shards should use the same
  codec hook and key naming as the queue WAL, so the WAL users share one implementation, as the
  owner asked earlier. The checkpoint partitioning by key hash does not apply here.
- The browser codec is `CompressionStream` (gzip), which is async. The pure module takes an async
  codec so tests can use the Node gzip codec the synthetic harness already uses.

## Still open

- **Shard size:** 16 KB is the default from the write bands, used for both the WAL flush threshold and
  the compressed shard target. Confirm, or give separate values.

## Components touched

- `shared/js/walSnapshotStore.js`: stop partitioning the completed area by key hash.
- `shared/js/swCoordinatorQueueWal.js`: the completed area leaves the queue WAL.
- `shared/js/sw.js`: archive, requeue removal, resident completed map, dashboard completed rows,
  `findCompletedWorkRowByKey`, the prune. The row-by-row prune script is written but not applied, and
  it is replaced by the shard drop.
- `shared/js/swQueueWalDurableReads.js`: reads from the index instead of the WAL.
- `shared/js/coordinator.js`: History reads the profile-keyed completed rows.
- New module, for example `shared/js/swCompletedLogShards.js`: pure functions for WAL append, flush to
  a compressed shard, drop by age, drop by cap, index build, and removal tombstones. Testable without
  storage.

## Steps

1. Pure module `swCompletedLogShards.js` with unit tests: WAL append, flush at size, compressed shard
   round trip, drop by age, drop by cap, index by profile, removal hides a row, clear.
2. Wire archive and requeue removal to the store behind one switch, so the old path can be compared
   during testing.
3. Index at hydrate; compare the index with a fresh decode after restart (the same check the runs WAL
   uses).
4. Limits: age and cap after a flush and at startup.
5. History reads the index. Clear drops all shards and the WAL.
6. Synthetic tests: a restart reads the same rows; a crash between a shard write and the WAL clear
   loses nothing; a dropped shard leaves no index entry; a removal hides a row without rewriting its
   shard; each archive write stays small.
7. Live check: write sizes per archive, flushes and shard drops per day, History against the
   dashboard terminal count.

## Risks

- Dropping a shard drops rows that are still "done" on the page. The page then offers those profiles
  again, which is accepted (owner decision 8). Count them in the flight recorder so the cost shows.
- Removals stay in the stored shard until it drops. A row removed and then re-added could be read
  twice unless the index keeps the newest record per profile. The index must resolve this, and the
  tests must cover it.
