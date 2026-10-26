# Progress split: storage on the page, CPU in a Worker, relay from the service worker

> **Status: REFERENCE** (24 Oct 2026). Probe (12 Oct): storage on the page, CPU in a worker, relay from the service worker. Planning input. Reference or dated data. Check before relying on its numbers. Register: [notes register](../../docs/notes-register.md).

Status: run 2026-10-12 on Chrome 154, isolated profile, one run of 200 storage samples, 30 relay samples per size, 30 load samples per case. Numbers from `results.json`. Planning input only. No shipped code changed.

Question: if `#progress` (an extension page) owns the storage calls and a dedicated Worker does the CPU work, and the service worker relays requests to it, what do storage latency, the relay, and CPU isolation cost, both in the foreground and when the page is hidden?

## Results

### Storage calls from the page (median / p95 / max, ms)

| Call | Foreground | Hidden |
|---|---|---|
| `storage.local.get`, 100 KB | 0.4 / 0.8 / 4.1 | 0.3 / 0.5 / 0.8 |
| `storage.local.set`, small | 0.2 / 0.4 / 3.6 | 0.2 / 0.3 / 0.3 |
| `storage.session.get`, 100 KB | 0.2 / 0.4 / 3.0 | 0.2 / 0.3 / 0.6 |
| `storage.session.set`, small | 0.1 / 0.3 / 2.9 | 0.1 / 0.2 / 0.4 |

A hidden page's storage calls are no slower than a foreground page's.

### Relay: service worker to page to Worker and back (median / p95, ms)

| Payload | Foreground total | Hidden total | Page and Worker only (fg / bg) |
|---|---|---|---|
| 0 B | 0 / 1 | 0 / 1 | 0.1 / 0.1 |
| 5 KB | 0 / 1 | 0 / 1 | 0.1 / 0.1 |
| 100 KB | 1 / 3 | 1 / 2 | 0.2 / 0.1 |
| 1 MB | 8 / 10 | 11 / 14 | 0.8 / 1.1 |

Small relays are effectively free. At 1 MB, most of the cost is copying the payload across the service worker to page message, not the Worker hop.

### CPU isolation: storage callback latency while the thread is busy (median / p95 / max, ms)

| Where the 200 ms of CPU work runs | Foreground | Hidden |
|---|---|---|
| Dedicated Worker | 0.8 / 1.1 / 1.3 | 0.8 / 1.1 / 2.1 |
| Page's main thread | 200.2 / 200.5 / 200.8 | 200.3 / 201.4 / 202.2 |

With the work in the Worker, a storage callback resolves in under 1 ms. With the same work on the main thread, it waits the full 200 ms.

## What this supports

- Storage calls from a hidden `#progress` are fast, so the storage I/O can stay on the page.
- The Worker can take the CPU work (codec, replay, hashing) without delaying storage callbacks. This shows the mechanism: main-thread CPU delays storage callbacks, and Worker CPU does not. It does not show that main-thread CPU caused the multi-second `storageGet` averages from the 1.6.1397 build. Those need re-measuring on the current build.
- The relay adds under 1 ms for small payloads. A full 1 MB state copy per message costs about 8 to 11 ms per hop, so messages should carry deltas or keyed rows, not whole state.

## Not covered

- Firefox. The same chain has not been run there.
- A real queue's payload sizes and call pattern; the 1 MB payload is a stand-in.
- Discarding of the page, and service-worker termination during a relay.
- Transferable `ArrayBuffer` payloads, which might cut the 1 MB copy cost.
- Whether busy CPU on the Worker slows the relay itself under sustained load.

## Reproduce

```bash
node experiments/progress-split/run-cdp.js 200 > experiments/progress-split/results.json
```
