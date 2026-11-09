# Persistent stores: one WAL and checkpoint engine, arrival-ordered shards

Status: design agreed with the owner (25 Oct 2026). Deferred on 24 Oct: performance is acceptable, so
this is follow-up work to capture, not to fix now. Partly built: the arrival-order option of the shared
engine (step 1, and part of step 2) is in commit bfbcee5, and no product code enables it. The queue's
log is already in arrival order, but its checkpoints are still split by key hash. Steps 4 to 7 are not
started. This replaces the earlier version of
this file, which described a separate completed-log store. That design is withdrawn.

## Store interface

Clients see two operations per store. Nothing else is visible outside the store.

- **`store(change)`:** store a change. The change is appended to the store's WAL as one record,
  then applied to the in-memory index. The call returns when the WAL write is durable.
- **`get(key)`:** the current record for a key, answered from the in-memory index. Never from a
  shard.
- **`list(filter)`:** a scan of the in-memory index, used by History and the dashboard. Also never
  from a shard.

Everything else is internal to the store: the WAL, the two checkpoint slots, the shards, the
compression, the expiry and the cap. None of it is part of the interface.

Consequences:

- The in-memory index holds everything the store can return. For terminal history it is bounded by
  the 10,000-row cap. For the queue it is bounded by the queue's own size.
- Reads never wait on a disk read after hydrate.
- The key is the profile for terminal history and runs, and the row for the queue.

## Why

The queue, runs and terminal history are persistent stores. They should use one engine: the shared
WAL and checkpoint code in `shared/js/walSnapshotStore.js`. Each store is an instance of that engine,
with its own WAL and its own checkpoint slots.

The engine today hash-partitions each checkpoint into a fixed number of shards and writes all of them
on every checkpoint. That has two costs:

- Consecutive WAL records land in different shards, so one flush can touch many shards.
- Every checkpoint rewrites unchanged shards, so the cost grows with the size of the store.

## Agreed rules

1. **Two slots, always.** Each instance keeps two checkpoint slots, A and B. The active slot is
   always a complete checkpoint, and the inactive slot takes the next write. Slots are independent:
   no shard is shared between them, and a slot's garbage collection touches only that slot. This is
   the redundancy and the recovery path.

2. **The WAL holds deltas.** Every change is a record appended to the instance's WAL. A WAL record is
   the only delta. Nothing else is stored as a delta.

3. **Shards are arrival-ordered, not hashed.** Each store is partitioned by arrival order into
   shards sized by bytes. A flush of consecutive WAL records lands in one shard, or two at a boundary.
   Hashing is removed from the engine for these stores.

4. **A checkpoint writes changed shards in full.** A shard that changed since the inactive slot was
   last written is written in full into that slot. A shard that has not changed since then is skipped.
   A shard is never written as a delta. Each slot gets its own full copy of a changed shard.

5. **The queue is sharded too.** Each queue row stores its shard id. Enqueues land in the tail shard,
   and completions shrink the head shard. A return to queued (a retry, a requeue, or a timeout that
   requeues) moves the row to the tail with one WAL record that sets its shard id, its queue sequence
   and its retry state together. That keeps the head draining, and the move is atomic.

6. **Expiry drops whole shards.** Runs and terminal history expire by age: a shard is dropped when
   its newest record is past the retention (90 days, the recent-history preference). Terminal history
   is also capped by row count (10,000, the existing maximum): the oldest shards go first. The
   resulting timing is loose, by design.

7. **Compression.** Shards are stored compressed through the engine's codec hook. The WAL is plain.

8. **Re-offered profiles are fine.** A profile whose terminal row has aged out can be offered again.
   It is processed quickly as already blocked, and that cost is accepted.

9. **Clear drops the shards.** Clearing history drops every shard of the terminal store and empties
   its WAL. Clear is harmless: it removes local memory only, not Quora's state.

10. **Storage is cleared with the change.** There is no migration.

## The index in memory

- Keyed by profile for terminal history and runs, and by row for the queue.
- It is separate from the on-disk layout. It is built at hydrate by reading the shards in order and
  then replaying the WAL.
- Lookups (the dashboard, History, the duplicate check, settlement) use the index, not the shards.
- A removal in the WAL hides the profile in the index. A later row for the profile shows it again.

## What changes in the engine

- Partition policy per instance: arrival-ordered shards for every store. The hash partition is
  removed for these stores.
- Shard keys are per slot, as they are now.
- The checkpoint writer compares each shard's content hash with the inactive slot's own last copy,
  and writes only the shards that differ, in full.
- Keyed row reads that used the hash are replaced by the in-memory index.
- Each slot's garbage collection removes only that slot's shards that its new manifest no longer
  lists.

## Components touched

- `shared/js/walSnapshotStore.js`: partition policy, the changed-shard writer, per-slot garbage
  collection.
- `shared/js/swCoordinatorQueueWal.js`: the queue's shard id per row, and the tail move as one record.
- `shared/js/sw.js`: terminal history, runs, the in-memory index, the retry path that moves rows to
  the tail, the expiry and cap checks, Clear.
- `shared/js/coordinator.js`: History reads the profile-keyed index.
- Tests: the existing WAL and checkpoint tests (walSnapshotStore, walCheckpointShards,
  walKeyedRead, walIncrementalVerify, the fuzz test) must keep passing, with changes only where they
  pin hash partitioning or per-slot shard names.

## Steps

1. Engine: arrival-ordered shard policy behind an instance option. Hash partitioning stays as the
   default for any caller that has not opted in, until the stores are moved.
2. Engine: the changed-shard writer, per slot, with the content-hash comparison.
3. Engine: per-slot garbage collection, and a test that a torn write of one slot leaves the other
   slot complete.
4. Queue: shard id per row, and the one-record tail move, behind a switch.
5. Terminal history and runs: arrival-ordered shards, the in-memory index, the expiry and cap checks.
6. History and the duplicate check read the index. Clear drops the shards.
7. Live check: bytes per checkpoint, shards written per checkpoint, and the terminal count.

## Open

- Shard size: about 16 KB compressed is the default. Confirm.
- Whether the queue's tail-move audit (every path that returns a row to queued) is done before step 4.
- Whether to remove the step 1 files, `shared/js/swCompletedLogShards.js` and its test, which are
  uncommitted and keep their own storage design.
