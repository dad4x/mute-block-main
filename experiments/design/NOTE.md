# Queue writer and storage mediation, existing storage backend: design note

> **Status: REFERENCE** (24 Oct 2026). Decision input (12 Oct) on queue writer and storage mediation over the existing backend. A hypothesis, not a decision. Reference or dated data. Check before relying on its numbers. Register: [notes register](../../docs/notes-register.md).

Status: 2026-10-12. Decision input and hypothesis, not a decision. Scope is the existing `storage.local` + WAL backend. IndexedDB and SQLite are out of scope here.

Correction from the earlier version: writes do not go through the service worker. Every write is a message to the owner, and the owner's Worker handles it. The service worker is not in the write path; it only wakes or starts the owner.

## Rule (settled 2026-10-12)

- **Nothing derived is persisted.** No projection, index, view or shard goes to `storage.local` or IndexedDB. Persisted state is the authority only: WAL segments, the manifest, checkpoints, and the pending marker.
- **`storage.session` is an allowed in-memory derived view.** The owner keeps it in sync with the authority, publishing after each commit with an epoch and sequence. It is a cache, not a store, and it is rebuilt from the WAL when the session area is empty.

## Derived data persisted today (code inventory)

| Key or path | Where | Status under the rule |
|---|---|---|
| `mbCoordinatorContentQueueIndex` and `mbCoordinatorContentQueueIndexShard.N` | `shared/js/sw.js:623`, `:674`; built in `swCoordinatorContentQueueIndex.js` | Derived, persisted. Move to the in-memory view. `content.js` reads it from storage (comment at `sw.js:271`), so its reads move too. |
| `mbCoordinatorContentSourceIndex.N` shards | `sw.js:624`, `:181` | Derived, persisted. Same treatment. |
| `mbProfileNukeProgressView` and `mbProfileNukeProgressShard.N` | written by `saveProfileNukeProgressRowProjection`, from terminal settlement at `sw.js:11572` | Derived, persisted. Progress must come from the WAL's `progress` area, which is already critical (`DEFAULT_RECOVERY_CRITICAL_AREAS`). |
| Terminal settlement derived payload | `buildTerminalCoordinatorSettlementDerivedPayload` in `swCoordinatorTerminalSettlement.js:196`; written at `sw.js:11559` to `:11580` | Derived, persisted. |
| Terminal progress projection | `saveTerminalProgressProjectionAfterAuthority` (`sw.js:6025`), `flushTerminalProgressProjectionSaves` (`sw.js:5989`) | Derived, persisted. |
| Archive and blocked-sweep projections | Named in the layering plan and the earlier live write-volume analysis; not yet located in code | To locate and inventory. |
| `mbCoordinatorQueueView` | Already not persisted (`sw.js:5735`, `:6185`, `:6205`) | Compliant. |
| `mbCoordinatorQueueViewTimingCache` | `sw.js:6095`, session area | In-memory cache. Compliant. |

Consequences the design must handle:
- **Startup.** With no persisted views, the owner's Worker rebuilds every view from replayed state at owner start. Replay and handoff are measured (see probe results); the full view rebuild is not.
- **Session publication.** The mirror is sharded, so a commit publishes only the shards it changes, never the full views. Each shard carries the commit's sequence. A manifest holds the sequence each shard was last published at. The owner writes the changed shards first and the manifest last. A reader accepts a view only when every shard it needs matches the manifest's sequence, and otherwise falls back to the owner. A torn publication therefore reads as stale, not as mixed.
- **Shard fan-out.** One mutation touches the queue row's shard and the progress shard, plus the content index shard and every source-index shard for that row's sources. The publication cost per commit is the number of shards touched times the shard size, not the size of the views. The shard helpers the content index already uses (`hashProjectionShardKey`, `getProjectionShardKey`) can be reused for the mirror's keying.
- **Quota.** The `storage.session` quota (about 10 MB) must hold the whole sharded mirror, not one commit's changes. That total is unmeasured on real rows.
- **Content reads.** The content path reads the session mirror where the browser allows it. Firefox is unverified there, so content falls back to the owner.

## Mock results (`experiments/mock-owner/NOTE.md`)

These are mock models, not measurements of the real code.

- **Publication, working range 10 to 20 shards.** Changed-shard publication cuts per-commit bytes against a full rewrite by 9x at 10 shards, 15x at 16 and 18x at 20. Median per commit is 107 KB, 68 KB and 55 KB, and a mutation touches about 5 shards (6 at most). The mirror total is about 974 KiB at the assumed row size, about 9.5% of the session quota. These figures assume 1 KB rows and are not measured.
- **Protocol.** Epoch fencing and the viewer epoch rule hold in the model. Exactly-once is not required; duplicate safety is set per mutation class.
- **Open.** Real row sizes, and per-key overhead in `storage.session` at the chosen shard count.

## The model

- **Owner.** `#progress` (an extension page) holds the `mb-owner` Web Lock. Only the owner can write.
- **Writer.** A dedicated Worker, started by the owner, holds the WAL state. For each mutation it produces a **commit package**: the authority writes (WAL segment, manifest, checkpoint when due, pending marker) and the in-memory mirror deltas (changed shards with their sequence). It writes no derived state to storage. The Worker is the only code that decides what to write.
- **Storage I/O.** A Worker can't call `chrome.storage`. The owner page is a passive I/O proxy: it performs every `storage.local` and `storage.session` call the commit package names, and returns acknowledgements. The page decides nothing.
- **Requesters.** Content scripts, the dashboard, the preferences page, and any other page send writes to the owner. They do not send writes through the service worker.
- **Service worker.** Stateless. It answers "owner absent" only when no owner holds the lock, and it wakes or starts the owner when none exists. It holds no queue state and is not in the write path.
- **Viewers.** Read a `storage.session` mirror, keyed by (epoch, seq). They subscribe to the `BroadcastChannel` first, then read the snapshot, then apply broadcasts above the snapshot's seq.

Write path for one mutation:

1. Requester sends `{requestId, mutation}` to the owner, with the epoch it last saw, using the routing transport below.
2. Owner forwards the request to the Worker.
3. Worker checks the epoch, builds the WAL record, and produces the commit package. It sets the pending marker as part of the package.
4. Owner executes the authority writes in the package with `chrome.storage.local.set`, and acknowledges to the Worker.
5. Owner executes the mirror publication in the package, following the commit boundary below. Only then does it emit the broadcast.
6. Worker commits resident state and clears the pending marker. Owner replies to the requester.

**Commit boundary (mirror).** The page writes the changed shards, awaits those writes, writes the manifest last, and awaits it. Only after the manifest write is acknowledged does it emit the `BroadcastChannel` message carrying the sequence. A viewer that sees a missing, old or removed shard for that sequence checks the manifest's membership list and requests a refresh. A broadcast therefore never advertises a sequence whose snapshot is still incomplete.

**Lock scope.** The owner's serialised writer lock covers state transitions and storage acknowledgements only. It must not be held across retries, waits for tabs to load, or UI coordination. The tab API itself is cheap from a hidden owner (about 2 to 11 ms per call), so the risk is the wait, not the call. If the lock spans waits, the current queue-wait shape returns under a different owner.

**Owner liveness.** A frozen owner holds `mb-owner` and blocks a handover. A discarded owner releases it. In a 35-minute hidden run Chrome did not freeze or discard the owner, but its main-thread timers slowed to about one per minute after five minutes hidden. So the owner's scheduling must run in its Worker, and a liveness rule still shouldn't assume a held lock means a working owner.

**Routing transport (tested in Chrome, not in Firefox).** Content scripts cannot use the extension's `BroadcastChannel`. A `runtime.sendMessage` from a content script reaches every running extension listener: the owner page if it is open, and the service worker if it is alive. The owner answers when it holds the lock, and the service worker answers "absent" only when no owner holds it. The four cases (owner present, absent then started, restarted with a reply in flight, and service worker terminated while replying) all recover by retry. Losses surface as a `sendMessage` error or a timeout, so the sender must retry.

**Mutation classes and duplicate safety.** The design accepts at-least-once delivery. Each mutation class needs its own duplicate-safe rule, and the rule must be shown, not assumed:
- *Queue enqueue.* Duplicate-safe if keyed by the existing dedupe key (href and attempt).
- *Terminal settlement.* Duplicate-safe if it is a conditional transition (apply only from the expected status).
- *Tab opening.* Not duplicate-safe by default; a duplicate open is visible to the user. Needs the attempt id checked before opening.
- *External action requests (block, mute).* Not duplicate-safe; a duplicate reaches Quora. Needs a per-request key checked against recorded outcomes.

## Probe results (2026-10-12, `experiments/design-probes/NOTE.md`)

Generic Chrome probes, no repo code. Each is one run, described in detail in its note.

- **Routing.** Owner present: 2 ms. Owner absent, then started: 3.3 s. Owner restarted with a reply in flight: the reply is lost, the request times out after 2 s, and the retry succeeds (3.8 s). Service worker terminated while replying: Chrome reports "message channel closed", and the retry succeeds.
- **Startup handoff.** 141 keys, 630 KB, 2,820 records. Read on the page: 4.4 ms. Structured-clone copy to the Worker plus replay: 1.6 ms (replay 1.2 ms). A buffer variant is slower, because encoding costs 3.1 ms. The earlier 8 to 11 ms per MB was the service-worker message path, not the page-to-Worker one.
- **Atomicity (one context).** 0 mixed reads in 200 concurrent set-and-get trials. This supports the claim that a single multi-key set is not torn in this setting. It does not cover two contexts reading at once.
- **Owner lifetime.** A frozen owner keeps `mb-owner`, so a waiter can't take over. Discard releases it, and the waiter acquires 5 ms later. Replacement readiness (read and replay 2,820 records): 10 ms. Whether Chrome freezes a hidden owner on its own is not yet known.
- **Tab API from a hidden owner.** `tabs.query` 1.8 ms, `tabs.create` 11 ms, `tabs.remove` 6 ms, close to the focused numbers. The tab API is not the gate. Holding the writer lock across waits is.

## Measurements from earlier experiments

Source notes are in `experiments/`.

| Claim | Evidence |
|---|---|
| Storage calls from a hidden page are sub-millisecond | `progress-split/NOTE.md` |
| Busy CPU in a Worker does not delay storage callbacks; busy CPU on the page's main thread delays them by its full duration | `progress-split/NOTE.md` |
| Small relays are cheap (under 1 ms); a 1 MB payload costs 8 to 11 ms per hop over the service-worker message path | `progress-split/NOTE.md` |
| Per-mutation WAL writes are two keys, about 2 KB, about 1.4 ms of CPU | `existing-wal/NOTE.md` |
| Startup from a sharded WAL with 128 tail segments reads about 0.8 MB across 141 keys, then replays for about 50 ms (Node, synthetic) | `existing-wal/NOTE.md` |
| Web Locks elect one owner; handover takes about 4 to 5 ms | `owner-election/NOTE.md`, `firefox-validation/NOTE.md` |
| Viewers receive `BroadcastChannel` updates without replay | `mirror-broadcast/NOTE.md` |
| Content scripts receive `storage.session` change events on Chrome. On Firefox the content script has no `storage.session` at all (confirmed), so content must reach the owner | `mirror-broadcast/NOTE.md`, `firefox-validation/NOTE.md`, `design-probes/NOTE.md` (Firefox) |
| A content-script Worker writes OPFS in the page's origin, not the extension's | `foreground-worker/NOTE.md` |
| Derived projections, not the WAL, dominate live write volume (about 146 MB per window against about 0.6 MB of WAL appends) | Live observation, 1.6.1389 window, recorded in project memory; not re-measured |

## What the measurements do not show

- **The cause of the historical waits.** Production `storageGet` averages of about 1 s, and `storageQueueWait` of about 2.7 s, were measured on 1.6.1397, before the current resident-state work. The Worker experiment shows that main-thread CPU delays storage callbacks. It does not show that this caused the production waits. Re-measure on the current build first.
- **Whether the writer design removes the waits.** The waits come from the serialised storage-update queue and from tab calls held inside it. A Worker writer that keeps the same queue keeps those waits.
- **The write volume that matters.** The WAL is small. The derived projections are not yet sized on real rows.
- **Real queue sizes.** All handoff and replay numbers use synthetic 141-key and 2,820-record shapes.

## Open design questions

1. **Derived projections.** Settled by the rule above: they are in-memory views, built by the Worker and published to `storage.session` as shards, never persisted. Open: the total size against the session quota, and the fan-out per mutation on real rows.
2. **Duplicate safety.** Exactly-once is not required, but at-least-once delivery means each mutation class needs a duplicate-safe rule (see Mutation classes above). Open: whether the existing attempt and WAL dedupe keys already cover queue enqueue and settlement; tab opening and external action requests need explicit keys.
3. **Atomicity of the physical write.** Single-context atomicity held in 200 trials. Open: two contexts reading at once. Until then, the pending and committed markers stay.
4. **Owner restart.** On start, the new Worker hydrates from storage and reads the pending marker. The replay and handoff cost is measured for 2,820 records (about 10 ms to readiness). The full view rebuild is not.
5. **Epoch fencing.** Requests carry the epoch the requester last saw. The Worker rejects requests from an earlier epoch. Viewers reject mirror entries from an earlier epoch.
6. **Tab operations.** The tab API is cheap from a hidden owner, so the question is no longer whether the owner can call it. Open: whether the executor's tab steps run inside the writer lock, and if so how to keep waits out of it.
7. **Content path on Firefox.** Content scripts cannot yet rely on `storage.session` events there. Until verified, Firefox content requests go through the owner.
8. **Owner lifetime (answered for one 35-minute run).** Discard releases the lock (5 ms to handover), freeze does not, and a replacement is usable in about 10 ms with 2,820 records. In the 35-minute hidden run, Chrome did not freeze or discard the owner, which held its lock throughout. Its timers slowed to about one per minute after five minutes hidden. Open: whether freeze or discard happens for an owner without a held lock, or under memory pressure.
9. **Real sizing (high priority).** Actual current-build sizes of the derived views and the session mirror, with real row shapes, per-key overhead in `storage.session`, and fan-out per mutation. The 974 KiB mirror model uses 1 KB synthetic rows and zero per-key overhead.
10. **Routing (partly answered).** Answered for Chrome: owner present, owner absent then started, a reply lost during an owner restart, and a reply lost during a service-worker stop all recover by retry. Open: several owner candidates, a request racing an owner's own startup, and Firefox.

## Next experiments, in order

Done in the 2026-10-12 probes: startup handoff, owner lifetime (discard and freeze), tab API from a hidden owner, routing (four cases), and single-context atomicity.

1. **Owner without a held lock, and memory pressure** (open): does Chrome freeze or discard an idle hidden page that holds no Web Lock, and does memory pressure change the answer? The 35-minute run (done) covered only a page holding the lock.
2. **Current lock-hold baseline** (queue paused, your go-ahead): lock-hold time per representative mutation, split into queue wait, CPU preparation, tab API time, durable write, session publication, and completion to next action. Establishes whether the current waits are where the design assumes.
3. **Real mirror sizing and fan-out** (current build, real row shapes): total shard bytes against the `storage.session` quota, per-key overhead, and shards touched and bytes republished per mutation. Needs the current code, not the mock.
4. **Multi-context atomicity**: a second extension page reads the 141 keys while a set is in flight.
5. **Routing edge cases**: several owner candidates, and a request racing an owner's startup.
