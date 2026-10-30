# IndexedDB spike: findings

> **Status: REFERENCE** (24 Oct 2026). IndexedDB spike (11 Oct). Planning input; nothing adopted, and no work done on it (owner, 24 Oct). Reference or dated data. Check before relying on its numbers. Register: [notes register](../../docs/notes-register.md).

Status: experiments run 2026-10-11 on Chrome 154 (Windows), isolated profile. Planning input only. No shipped code changed, no version bump, no change to the live extension or queue.

Context: [docs/queue-storage-layering.md](../../docs/queue-storage-layering.md) (the WAL layer owns storage; `storage.session` mirror for cross-context reads). Question: would a single IndexedDB store, under the WAL layer, replace the segmented WAL, checkpoints and mirror markers?

## Answers

| # | Question | Answer | Evidence |
|---|---|---|---|
| 1a | Does an open IndexedDB transaction chain keep the MV3 worker alive? | **No.** A continuously chained IndexedDB write loop (about 4,500 transactions/s) was killed at 30.1 s, the same as a plain timer control (30.2 s). Both hit Chrome's idle timeout. | `results-keepalive-idb.json`, `results-keepalive-timer.json` |
| 1b | Is a write atomic when the worker dies mid-transaction? | **Yes, in 30 of 30 forced kills.** 4 writes committed, 26 were interrupted. In every final state, all rows carried one sequence matching the marker: either the new commit or the previous committed state. No mixed state. | `results-atomic.json` |
| 2 | Latency vs the current storage path? | Per call, raw I/O is comparable. Keyed reads are cheaper because they touch fewer bytes. Table below. | `results-bench.json` |
| 3 | Can IndexedDB complete under the test suite's clock? | **Not under a microtask-only flush.** An operation did not settle after 10,000 microtask rounds. It needs macrotask turns: 2 for one put, 3 for a two-put transaction. Disabling `setTimeout` changes nothing. | `fake-tick-check.js` (stdout) |
| 4 | Is a one-time import verifiable and safe to roll back? | **Yes.** A full import round-trips to the same state hash. A dropped shard is rejected as `missing-checkpoint-shard`. An aborted import leaves no partial keys. The legacy payload is unchanged in all cases. | `migrate-check.js` (stdout) |

Also tested, not in the original list:
- **Content scripts.** A content script on a `127.0.0.1` page sees only its own page-origin IndexedDB, not the extension's `spike` database. It can read `storage.session` after `setAccessLevel`. This confirms the plan's design: content scripts reach the mirror, not the authority.

## Latency (median ms, p95 in results files)

Worker (service worker context):

| Operation | Median | p95 |
|---|---|---|
| `storage.local.get`, 1 MB string | 4.5 | 5.2 |
| `storage.local.get`, 100 KB string | 0.30 | 0.40 |
| `storage.local.set`, 100 KB string | 0.40 | 0.70 |
| IDB get, one 2 KB row | 0.10 | 0.20 |
| IDB getAll, 2,000 rows (4 MB) | 21.3 | 25.6 |
| IDB put, one row, own transaction | 0.20 | 0.40 |
| IDB two-store transaction, 2 puts | 0.30 | 0.30 |

Extension page (the dashboard path):

| Operation | Median | p95 |
|---|---|---|
| `storage.session.get`, 1 MB string | 2.9 | 3.4 |
| `storage.local.get`, 1 MB string | 4.2 | 4.9 |
| IDB getAll, 2,000 rows (4 MB) | 22.2 | 35.0 |
| IDB get, one 2 KB row | 0.10 | 0.40 |

Reading: IndexedDB's whole-store read is about 5 ms per MB, close to `storage.local`'s 4.5 ms per MB. Single-row reads are about 0.1 ms, and the current keyed read reads one shard plus the WAL tail, which was 1.74 MB per call in the 2026-10-10 window. The win is bytes read, not per-call speed. For full-queue reads from a dashboard, `storage.session` is about 1.5x faster than IndexedDB at this size.

## Method

Everything is in `experiments/indexeddb/`:
- `ext/` is the probe extension: a service worker (`sw.js`), an extension page (`page.html` and `page.js`), and a content script on `127.0.0.1`.
- `run-cdp.js` launches an isolated Chrome with its own profile and debug port 9333. It loads the probe with `Extensions.loadUnpacked`, because branded Chrome 137+ ignores `--load-extension`. It wipes its own `.profile/` before each run. It never touches the user's Chrome or the live extension.
- `fake-tick-check.js` and `migrate-check.js` run in Node against `fake-indexeddb` 6.2.5, which is installed in `experiments/indexeddb/node/` and not in the repo's `package.json`.

Reproduce (one command per line):

```bash
node experiments/indexeddb/run-cdp.js keepalive-idb 60
node experiments/indexeddb/run-cdp.js keepalive-timer 60
node experiments/indexeddb/run-cdp.js atomic 30
node experiments/indexeddb/run-cdp.js bench
node experiments/indexeddb/run-cdp.js content
node experiments/indexeddb/fake-tick-check.js
node experiments/indexeddb/migrate-check.js
```

Setup needed: `cd experiments/indexeddb/node && npm install fake-indexeddb@6`.

## Method notes and mistakes fixed along the way

- The first keepalive probe held the message reply open. An open message port keeps a Manifest V3 worker alive, so the timer control survived for the wrong reason. The probe now replies immediately and writes a done marker.
- Loading an unpacked extension into a profile that already has it reused the old `sw.js`. Each run now starts from a clean profile.
- The first bench ran against an empty database, so the IndexedDB numbers were meaningless. It now seeds the database first.
- The first forced-kill run found no worker version to stop, because the version tracking never captured one. It now uses `ServiceWorker.stopAllWorkers` on the probe's own page session, which kills only the probe worker.
- The first atomicity run killed every write inside the write window, so it never saw a commit followed by a kill. It now calibrates the commit time first (281 ms for 2,000 rows) and spreads kill delays across 0 to 1.2 times that window.

## Caveats

- Forced termination is `ServiceWorker.stopAllWorkers`. That is a clean stop, not a process crash, a browser crash, or a power loss. Crash durability is not tested.
- Sample size is 30 kills, 4 of them committed. That is enough to show no partial state was seen. It is not enough to bound the probability of one.
- The latency numbers come from one machine, with no control of cold versus warm cache, and at 2,000 synthetic 2 KB rows, not the real queue.
- Migration timings come from `fake-indexeddb`, which is in memory and not representative. Only the correctness results carry over.
- Firefox event pages were not tested here. The earlier 2026-10-11 probe showed `storage.session` survives an event-page unload in Firefox.

## Not tested yet

- Whether `storage.local.set` with several keys is atomic. The layering plan's pending-marker design assumes it is not, and this spike did not check that claim. It matters for deciding what IndexedDB buys us.
- A real queue: the actual row sizes and count, and the real migration of a live profile.
- Whether a worker terminated by Chrome's own idle timeout (rather than `stopAllWorkers`) leaves an in-flight transaction in the same state.
- Firefox behaviour for the same probes.

## Implications for the layering plan

- The keepalive result matters most. A worker is alive only while extension events arrive, and long IndexedDB work does not extend that. Any write or migration must be short transactions, and an interrupted one rolls back cleanly, which is the behaviour the atomicity result shows.
- The atomicity result means the pending and committed markers in section 6 of the layering plan would be unnecessary, if IndexedDB is the authority and the transaction carries the sequence.
- Content scripts cannot reach an IndexedDB authority. They would need to read the `storage.session` mirror or ask the worker, which matches what the plan already does.
- Per-call latency does not favour IndexedDB. The gain is fewer bytes per keyed read and no segment or checkpoint machinery. That is a design argument, not a measured speed argument.
- Next steps, if the spike continues: test `storage.local` multi-key atomicity, run the probes in Firefox, and measure on real queue data with the queue paused.
