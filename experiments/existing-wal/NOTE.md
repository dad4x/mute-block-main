# Existing storage.local + WAL: sizing at a 1,000-row queue

> **Status: REFERENCE** (24 Oct 2026). Sizing of the existing storage and WAL at a 1,000-row queue (12 Oct). Planning input. Reference or dated data. Check before relying on its numbers. Register: [notes register](../../docs/notes-register.md).

Status: 2026-10-12. Offline, Node, using the repo's `shared/js/walSnapshotStore.js` directly. No browser, no live queue. Planning input only. No shipped code changed.

Question: what does the existing WAL backend write and read per mutation, at checkpoint switch, and at startup, for a 1,000-row queue? This is the cost a Worker-owned writer would have to carry.

## Method

`experiments/existing-wal/sizing.js` builds a sharded checkpoint from a synthetic 1,000-row queue (plus completed rows, progress rows and runs), then:
- sizes the checkpoint as written by `buildSegmentedWalStoragePayload`,
- appends 20 mutations one at a time and sizes the payload each one writes,
- builds a startup state with 128 WAL tail segments, then times `hydrateSegmentedWalStore` and `recoverProjectedState`.

Two bracket runs, because row text compresses differently:
- repetitive row text (`RANDOM_NOTES` unset) under-sizes the checkpoint,
- incompressible row text (`RANDOM_NOTES=1`) brackets it from above.

Codec: gzip via zlib, as the tests use. Production uses the repo's own codec, so byte counts are approximate. Timings are Node on this machine, so they show relative cost, not Chrome's.

## Results

| Measure | Repetitive text | Incompressible text | Production (live window, 1.6.1389 to 1396) |
|---|---|---|---|
| Checkpoint, all keys | 55 KB | 636 KB | about 1.0 MB |
| Per mutation, bytes written | 1,277 B | 1,915 B | about 3.3 KB average WAL append |
| Per mutation, keys written | 2 | 2 | not recorded |
| Per mutation, CPU (append plus payload build) | not recorded | 1.4 ms | not recorded |
| Startup, keys read | 141 | 141 | not recorded |
| Startup, bytes read | 154 KB | 811 KB | not recorded |
| Startup, hydrate | 1.8 ms | 1.8 ms | not recorded |
| Startup, recover and replay 128 tail segments | 33 ms | 50 ms | not recorded |

## What this shows

- **Steady state is small.** Each mutation writes two keys and about 2 KB, and about 1.4 ms of CPU. The WAL append path is not where the seconds go.
- **Checkpoints and startup are the heavy WAL operations.** A checkpoint is about 0.6 to 1.0 MB. Startup reads about 0.8 MB across 141 keys before replay, so a Worker that owns the WAL would receive that through the page (about 8 to 11 ms per MB, measured in `experiments/progress-split/NOTE.md`), then replay it.
- **The live write volume is not in the WAL.** The 1.6.1389 window recorded about 0.6 MB of WAL appends and one 1.0 MB checkpoint, against about 146 MB of derived-projection writes (content queue index shards, source index shards, terminal settlement, archive, terminal progress, blocked sweep). Those projections, not the WAL, are the dominant write cost in that window. This note does not size them: the projection builder in `shared/js/swCoordinatorContentQueueIndex.js` is a factory with about twenty dependencies, so it isn't loadable on its own yet.

## Limits

- Synthetic rows. The bracket is the best available estimate, not a measurement of the live queue.
- Node timings, not Chrome.
- No derived projections (see above).
- No live lock-hold measurement, which needs the queue paused.

## Next

1. Size the derived projections by wiring `createCoordinatorContentQueueIndex` and its dependencies in Node, then measure bytes per window at 1,000 rows.
2. Measure startup transfer end to end in Chrome, with 141 synthetic keys of this size: `chrome.storage.local.get` on the page, `postMessage` to a Worker, replay in the Worker.
3. Test whether one multi-key `chrome.storage.local.set` is atomic under concurrent reads. The existing pending and committed markers assume it isn't.
4. With the queue paused and your go-ahead: lock-hold time per representative mutation, split into queue wait, CPU preparation, tab API time, durable write, session publication, and completion to next action.

## Reproduce

```bash
node experiments/existing-wal/sizing.js 1000 128
RANDOM_NOTES=1 node experiments/existing-wal/sizing.js 1000 128
```
