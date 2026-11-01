# Mock owner model: publication cost and protocol structure

> **Status: REFERENCE** (24 Oct 2026). Mock model (12 Oct) of publication cost and the owner protocol. Mocks only. Reference or dated data. Check before relying on its numbers. Register: [notes register](../../docs/notes-register.md).

Status: 2026-10-12. Mocks only. `run.js` imports nothing from the repo. Rows, shards, storage and the owner protocol are simplified stand-ins, so these results show how costs scale and which protocol cases hold in the model. They are not measurements of the real code or of Chrome.

Requirement change: exactly-once is not required. The design accepts at-least-once delivery, so each mutation class needs its own duplicate-safe rule (see the design note). The mock's `appliedKeys` check in the crash-retry case is idempotency, and it is kept as the model of a duplicate-safe apply. The protocol cases check fencing and the mirror rules, not exactly-once.

## Publication cost (1,000 rows, mock row size about 1 KB)

Each row feeds four views: queue, progress, content index, and source index (one entry per source, 1 to 3 sources per row). Views are sharded by key hash. A mutation touches the row's queue, progress and content-index shards, plus one source-index shard per source.

| Shards | Mirror total (KiB) | Full rewrite per commit | Changed shards, median | Changed shards, p95 | Shards touched, median (max) | Reduction at median | Median per commit, 4 sources |
|---|---|---|---|---|---|---|---|
| 10 | 974 | 998 KB | 107 KB | 122 KB | 5 (6) | 9x | 124 KB |
| 16 | 974 | 998 KB | 68 KB | 75 KB | 5 (6) | 15x | 78 KB |
| 20 | 974 | 998 KB | 55 KB | 64 KB | 5 (6) | 18x | 62 KB |
| 32 | 974 | 998 KB | 35 KB | 41 KB | 5 (6) | 29x | 41 KB |

The 128 and 512 shard runs are out of the working range, and their rows are in `results-shards-128.json` and `results-shards-512.json` for reference.

Reading, for the 10 to 20 shard range:
- Changed-shard publication is still a large reduction over a full rewrite: 9x at 10 shards, 18x at 20.
- The mirror total is independent of shard count (974 KiB, about 9.5% of the 10 MB session quota at this assumed row size).
- A mutation touches about 5 shards whatever the count (6 at most). Per-commit bytes therefore scale with shard size, which falls as the count rises.
- At 20 shards, a commit writes about 55 KB median, 64 KB at p95. At 10 shards it's about 107 KB median.
- The model has no per-key overhead. Twenty keys is a small count for `storage.session`, so the key-count cost is unlikely to decide between 10 and 20 shards.
- Limits: real row sizes are unknown.

Fan-out: each extra source adds roughly one shard, so per-commit bytes grow by about a shard's worth per source (at 20 shards, 49 KB for 1 source, 62 KB for 4).

## Startup handoff (mock timing)

A 141-key, 1.07 MB WAL payload: a structured clone in Node takes about 1 ms, and an ArrayBuffer copy about 0.2 ms. Node is not Chrome's `postMessage`. The Chrome relay measurement in `experiments/progress-split/NOTE.md` (8 to 11 ms per MB per hop) is the better figure for the handoff.

## Protocol cases (logic only)

| Case | Result |
|---|---|
| Normal write applied | Pass |
| Owner crashes after physical write, before ack; retry on the new owner | Pass (duplicate ignored; not required by the revised requirement) |
| Owner crashes before physical write; retry on the new owner | Pass |
| Stale owner's write after handover | Pass: fenced by epoch, not in the log |
| Viewer receives a broadcast from an earlier epoch | Pass: ignored |

The epoch fence and the viewer rule still matter: they stop an earlier owner from overwriting current state, which sloppy retries would not prevent. The idempotency-key cases are kept for reference, but no longer gate the design.

## Reproduce

```bash
node experiments/mock-owner/run.js
MOCK_SHARDS=128 node experiments/mock-owner/run.js
MOCK_SHARDS=512 node experiments/mock-owner/run.js
```

Results: `results.json` (32 shards), `results-shards-128.json`, `results-shards-512.json`.
