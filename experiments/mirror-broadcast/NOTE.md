# Mirror broadcast: does it work as the viewer path needs?

> **Status: REFERENCE** (24 Oct 2026). Probe (12 Oct): can an owner page publish mirror updates on a broadcast channel. Planning input. Reference or dated data. Check before relying on its numbers. Register: [notes register](../../docs/notes-register.md).

Status: run 2026-10-12 on Chrome 154, isolated profile, one run, all numbers from `results.json`. Planning input only. No shipped code changed.

Question: can an owner page publish mirror updates on a `BroadcastChannel` (plus `storage.session`), so that other extension pages, the service worker and content scripts stay current cheaply?

Setup: an owner page (holds the `mb-owner` Web Lock, publishes `{epoch, seq, sentAt}` on `mb-mirror` and writes `mirrorEpoch`, `mirrorSeq`, `mirrorSentAt` to `storage.session`), two viewer pages, the service worker, and a content script on a local page. 300 updates per burst, 10 ms apart.

## Results

| Phase | Result |
|---|---|
| 1. Steady delivery | Both viewer pages received 300 of 300 broadcasts, no gaps. Mean lag 0.3 ms, p95 1 ms. The `storage.onChanged` path also delivered 300 of 300, mean lag 0.5 ms. Service worker received 300 of 300. |
| 1b. Content script | `BroadcastChannel` received 0 messages, as expected: the content script is in the page's origin. `storage.onChanged` received 300 of 300, mean lag 0.6 ms. |
| 2. Late joiner | Joined mid-burst. Received seq 394 to 600 with no gaps, but nothing before its subscription. Reading the mirror on join gave seq 600. Broadcasts are not replayed, so a joiner needs a snapshot read. |
| 3. Service worker stopped mid-burst | Burst seq 601 to 900. The service worker, after restart, saw seq 693 to 900. Seq 601 to 692 were lost while it was down. Its `storage.onChanged` listener likewise missed them. The progress viewer, which stayed up, received all 900. |
| 4. Owner handover | Second owner queued for the lock, took over when the first closed, and published epoch 2 from seq 1. Both viewers handled the epoch change, keyed by (epoch, seq), with no gaps in either epoch. |

Hidden viewers received updates with the same low lag as the foreground owner, so event delivery is not throttled the way timers are.

## Findings that change the design

1. **The publisher must not depend on main-thread timers in a hidden page.** The owner in phase 1 was a background tab while bursting. Its 10 ms pacing ran at about one step per second, matching the page-throttling result. Publishing has to run in a dedicated worker, or in a page that has focus.
2. **Joiners need subscribe-then-read.** A viewer must subscribe to the channel first, then read the mirror snapshot, then apply broadcasts with a seq above the snapshot's seq. Reading first leaves a window where updates are lost.
3. **The service worker can't rely on broadcasts for correctness.** It misses everything sent while it is stopped. On start it must read the mirror and reconcile, and treat a seq gap as a reason to reload.
4. **Content scripts should use `storage.session` change events.** `BroadcastChannel` does not reach them. The `storage.onChanged` path was fast in this run (about 0.6 ms mean), but it's one run, and the content path has not been tested with a real page's load.
5. **Epoch plus seq is a sound key.** Handover produced clean, separable streams.

## Artifacts in this run

- Phase 2 took 3.5 minutes instead of about 3 seconds, because opening the late viewer tab took focus away from the owner, which throttled it again. The timing is an artifact of the driver, but it confirms finding 1.
- A leftover Chrome process from an earlier timed-out run was still holding a profile. It was not killed, and it uses its own profile and port (9338), so it is not the user's browser.

## Not covered

- A dedicated-worker publisher (finding 1 recommends it, but this run used the page's main thread with focus).
- Discarding and freezing of pages.
- Storage quota for the real view sizes.
- Behaviour across a real browser restart, where `storage.session` is cleared.

## Reproduce

```bash
SPIKE_CDP_PORT=9342 node experiments/mirror-broadcast/run-cdp.js > experiments/mirror-broadcast/results.json
```
