# Experiments

Status as of 24 Oct 2026. Probe code, results, and short notes from 10 to 21 Oct 2026. Every entry here is REFERENCE: planning input, not a decision. None of the probes changed shipped code. The status of every note is in [docs/notes-register.md](../docs/notes-register.md). Priorities are in [planning.md](../planning.md). Dead ends are in [docs/dead-ends.md](../docs/dead-ends.md).

The Chrome profile copies (`.profile-*` folders) made by the probes were quarantined on 24 Oct, and so were the `node_modules` folders of two probes. The notes do not need them. See [removed-2026-10-24.md](../historical/removed-2026-10-24.md).

| Probe | Date | What it asked | What the note records | Note |
|---|---|---|---|---|
| design-probes | 12 Oct | Routing, startup handoff, atomicity, owner lifetime, and the tab API | One run per probe, in one storage context. It does not prove atomicity under every interleaving. | [NOTE](design-probes/NOTE.md) |
| design | 12 Oct | Queue writer and storage mediation over the existing backend | A hypothesis and decision input, not a decision. | [NOTE](design/NOTE.md) |
| existing-wal | 12 Oct | Whether one multi-key storage write is atomic under concurrent reads, and how large the log is at a 1,000-row queue | Offline, using the repo's WAL code directly. Planning input. | [NOTE](existing-wal/NOTE.md) |
| findings-2026-10-21 | 20 to 21 Oct | Timers in the worker, the page, and the service worker; the direct API | A service-worker timer did not survive 35 minutes. A dedicated Worker on a hidden page kept a 1 s timer. Set aside. | [findings](findings-2026-10-21.md) |
| firefox-validation | 12 Oct | Worker, election, and broadcast on Firefox | One run. Planning input. | [NOTE](firefox-validation/NOTE.md) |
| foreground-worker | 11 Oct | The origin of a foreground worker, on Chrome | Planning input for the worker-window design. | [NOTE](foreground-worker/NOTE.md) |
| indexeddb | 11 Oct | Whether IndexedDB beats the current storage path | Per call, raw I/O is similar. Keyed reads are cheaper because they touch fewer bytes. Nothing adopted, and no work done on it (owner, 24 Oct). | [NOTE](indexeddb/NOTE.md) |
| mirror-broadcast | 12 Oct | Whether an owner page can publish mirror updates on a broadcast channel | Planning input. | [NOTE](mirror-broadcast/NOTE.md) |
| mock-owner | 12 Oct | Publication cost and the owner protocol, with mocks | Mocks only. The epoch fence and the viewer rule still matter: they stop an earlier owner from overwriting current state. | [NOTE](mock-owner/NOTE.md) |
| owner-election | 11 Oct | Owner election across extension pages, with Web Locks | Planning input. | [NOTE](owner-election/NOTE.md) |
| page-throttle | 11 Oct | Foreground versus background throttling of extension pages | Planning input. | [NOTE](page-throttle/NOTE.md) |
| progress-split | 12 Oct | Storage on the page, CPU in a worker, relay from the service worker | A Worker can take the CPU work (encoding, replay, hashing) without delaying storage callbacks. | [NOTE](progress-split/NOTE.md) |
| sqlite | 11 Oct | SQLite options for the queue and the dashboard | Counts by status can be a single query. Nothing adopted, and no work done on it (owner, 24 Oct). | [NOTE](sqlite/NOTE.md) |
| quora-direct-api | 15 Oct | Direct extraction through Quora's own API | Mutations (block, mute) were declined because they bypass Quora's anti-bot token check. Reads parked. Dead end. | [README](quora-direct-api/README.md); [direct-api-used.md](../direct-api-used.md) |

Notes on the table:

- "Planning input" means the result informs a design. It is not a decision and not a record of shipped behaviour.
- Results from one run, on one profile, are one data point.
- The `indexeddb/node` and `sqlite/node` folders held the probes' own dependencies (about 0.6 MB and 3.0 MB). Their `node_modules` folders were quarantined on 24 Oct. The product does not use them.
