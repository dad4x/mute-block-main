# SQLite options: findings

> **Status: REFERENCE** (24 Oct 2026). SQLite options (11 Oct). Planning input; nothing adopted, and no work done on it (owner, 24 Oct). Reference or dated data. Check before relying on its numbers. Register: [notes register](../../docs/notes-register.md).

Status: experiments run 2026-10-11 on Chrome 154 (Windows), isolated profile. Planning input only. No shipped code changed, no version bump, no change to the live extension or queue.

Context: [experiments/indexeddb/NOTE.md](../indexeddb/NOTE.md) (the IndexedDB spike). Question: is SQLite (sqlite-wasm with OPFS, or a wrapper) a better backing store for the queue than IndexedDB, and where can it run?

## Short answers

- **Can the service worker host SQLite with OPFS?** No. Tested: the MV3 service worker has no `Worker` constructor, and `FileSystemFileHandle.createSyncAccessHandle` is absent, so sync OPFS access is unavailable there. The service worker can't be the database host.
- **Is a dedicated `Worker` the answer instead of the service worker?** Not on its own. A dedicated Worker can only be created by a document, and it doesn't receive `chrome.*` events, so the service worker has to stay as the event entry point. The working split is: service worker coordinates, an **offscreen document** creates a dedicated Worker, and the Worker owns the SQLite handle. Tested end to end.
- **Does SQLite work in that split?** Yes. Both `opfs-sahpool` and `opfs` VFSs open in the dedicated Worker. Writes, keyed reads and scans all run. Killing the Worker inside an open transaction rolled back cleanly in all 20 targeted kills.

## Options compared

| Option | Runs in MV3 service worker | Runs in offscreen/extension page | Persistence | Single-writer fit | Notes |
|---|---|---|---|---|---|
| **sqlite-wasm + OPFS, in a dedicated Worker hosted by an offscreen document** | No (service worker has no sync handles) | Yes, tested | OPFS, journal mode `delete` | Yes, the offscreen document is the owner | Chrome only (offscreen API). Needs a manifest CSP change (`'wasm-unsafe-eval'`). Tested. |
| sqlite-wasm + OPFS, in the service worker | No, tested | n/a | n/a | n/a | Not possible: no Worker, no sync handles. |
| **wa-sqlite with an async (IndexedDB-backed) VFS** | Plausibly yes, async VFS needs no sync handles | Yes | IndexedDB | Works in the service worker | **Not tested.** Best candidate if the SQL layer must run in the service worker and avoid offscreen. |
| sql.js | Yes (in memory) | Yes | None built in; export the whole file to storage | Poor | Persisting means rewriting the whole database blob, which is the cost the WAL work is trying to remove. Dismissed. |
| Evolu | Not directly | Via its own worker | Built on sqlite-wasm + OPFS | Designed for multi-device sync | Brings a data model, sync and CRDT machinery we don't need. Dismissed for this queue. |
| IndexedDB (previous spike) | **Yes, tested** | Yes | IndexedDB | Works from the service worker | Not SQL. Atomic transactions, 0.1 ms keyed reads. Simplest for Chrome. |

## Measurements (Chrome 154, sqlite-wasm 3.53.4)

Worker-side, on the 2,000-row, 2 KB-per-row dataset:

| Operation | Median | p95 |
|---|---|---|
| Keyed read, one row by primary key | below timer resolution (reported 0 ms) | 0.1 ms |
| Full scan, 2,000 rows (4 MB) | 6.3 ms | 7.7 ms |
| Single-row autocommit write | 5.5 ms | 6.4 ms |

For comparison, the IndexedDB spike measured a 0.1 ms single-row read, 21 ms for a 2,000-row `getAll`, and a 0.2 ms single-row put, all from the service worker. Note the SQLite numbers come from a Worker and the IndexedDB numbers from the service worker, so they are not a like-for-like race. Note also that SQLite autocommit writes are about 25 times slower than an IndexedDB put, so batching into transactions matters.

Commit of a 2,000-row transaction (killable calibration): about 70 ms.

## Kill and atomicity results

Deterministic mid-transaction kills (`results-kill.json`): the Worker is terminated at a chosen chunk boundary inside an open `BEGIN IMMEDIATE` transaction. The worker yields between 100-row chunks and reports progress, so the host knows when it has reached the target.

- 20 of 20 kills landed mid-transaction.
- 20 of 20 reopened on the first attempt.
- All 20 final states matched the previous committed state, with no partial rows and no new marker. Rollback-on-open works.

Kill during open (`results-kill-open.json`): 10 of 10 kills during the database open reopened on the first attempt, in 83 to 94 ms.

Lock behaviour, one observation: in an earlier run that used timed kills, 4 of 20 reopens failed with `Failed to execute 'createSyncAccessHandle' ... Access Handles cannot be created`. Those kills landed unpredictably around the first write, and the driver had no retry. The targeted runs above did not reproduce it in 30 kills. I have not found the cause, so the design should not assume reopen always succeeds on the first try: it needs a retry with backoff and a bounded wait.

Service-worker stop (`results-sw-kill.json`): stopping the service worker left the offscreen document and its Worker alive, and a read through the Worker returned the last committed state without reopening. The database handle lives in the offscreen document, not the service worker.

## Things the snippet in the proposal assumed, and what the probe showed

- **COOP/COEP headers.** The proposal says OPFS workers need `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy`. In this probe, the offscreen document was **not** cross-origin isolated (`crossOriginIsolated: false`), and both VFSs still opened. Extension pages can't set those headers anyway. This matches the `opfs-sahpool` VFS, which is designed to work without them. The claim is not confirmed for the `opfs` VFS in every configuration.
- **Worker in the page.** The snippet's `new Worker('worker.js', {type: 'module'})` is what the offscreen document does here. That works, but only inside a document that stays open.
- **Transient fallback.** The snippet falls back to a transient in-memory database if OPFS is unavailable. For this queue that fallback would be a silent data loss path, so it should be an error, not a fallback.
- **Manifest CSP.** The default extension CSP blocked WebAssembly compilation (`'wasm-eval' nor 'unsafe-eval'`). The probe needed `"content_security_policy": {"extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"}`. That is a manifest change for both Chrome and Firefox, to be reviewed as a permission-like change.

## Test-harness fit

`experiments/sqlite/node/sync-check.mjs` (node, `sqlite-wasm` 3.53.4, in-memory DB): after initialisation, `db.exec` returns synchronously, a write is visible on the next line without awaiting, and `BEGIN`/`ROLLBACK` restores the count. That is the property the fake-timer harness needs. The IndexedDB spike found that IndexedDB operations need macrotask turns, which the suite's microtask-driven clock can't advance. So sqlite-wasm's synchronous API is a real advantage for the existing test suite. Only the in-memory case was checked here, not the OPFS VFS.

## Implications for the queue

- **Ordered executor index (layering plan, mirror Phase 4).** This is where SQL pays: `ORDER BY queue_sequence LIMIT N` with an index, instead of a hand-maintained ordered structure. This was the main reason to look at SQL at all.
- **Dashboard aggregates.** Counts by status and per-run totals are a single query, not a full-state scan in the worker.
- **Cost.** Chrome only via offscreen. A manifest CSP change. An extra document that must be kept alive and reopened with retry. Autocommit writes are about 5.5 ms, so the queue must batch writes into transactions.
- **Firefox.** Not tested. Firefox has no offscreen API. Event pages are documents, so a dedicated Worker might be created there directly with OPFS. That needs a probe before it is assumed.

## Recommendation (for discussion, not decided)

1. If the queue wants SQL queries, particularly the ordered index, the **offscreen-hosted sqlite-wasm** split works in Chrome and is tested. It costs an offscreen document, a CSP change, and Firefox work.
2. If the queue only needs keyed reads and atomic transactions, the **IndexedDB** spike result is simpler, runs in the service worker, and needs no new documents or CSP changes.
3. The **untested middle option** is wa-sqlite with an IndexedDB-backed VFS, which would give SQL inside the service worker. It is the next probe if SQL is wanted but the offscreen split is unacceptable.

## Dedicated worker capabilities (extension origin)

Probed inside the offscreen-hosted dedicated worker (`globals` op, `ext/db-worker.js`):

| Global | Available |
|---|---|
| `chrome` (extension APIs, including `chrome.storage`) | **No** |
| `BroadcastChannel` | Yes |
| `navigator.locks` (Web Locks) | Yes |
| `SharedWorker` | No |
| Origin | `chrome-extension://…` (same as the extension page that created it) |

Consequence: a dedicated worker can do CPU and OPFS/IndexedDB work, but all `chrome.storage` I/O must stay on the page's main thread or the service worker.

## Not tested yet

- wa-sqlite with an IndexedDB VFS, inside the service worker.
- Firefox: dedicated Worker plus OPFS from an event page, and CSP behaviour.
- The 4-in-20 reopen failure: cause and whether it recurs under a realistic write load.
- Multi-tab: only one offscreen document is created, but the behaviour when the extension is reloaded during a write is untested.
- Long-running offscreen document lifetime (hours, across browser idle periods).
- Query performance with the real queue schema and indexes.

## Reproduce

Setup: `cd experiments/sqlite/node && npm install @sqlite.org/sqlite-wasm@latest`

```bash
node experiments/sqlite/run-cdp.js caps
node experiments/sqlite/run-cdp.js bench
node experiments/sqlite/run-cdp.js kill 20
node experiments/sqlite/run-cdp.js kill-open 10
node experiments/sqlite/run-cdp.js sw-kill
node experiments/sqlite/node/sync-check.mjs
```

Results files: `results-caps.json`, `results-bench.json`, `results-kill.json`, `results-kill-open.json`, `results-sw-kill.json`.
