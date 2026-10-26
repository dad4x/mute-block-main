# Design probes: routing, startup handoff, atomicity, owner lifetime, tab API

> **Status: REFERENCE** (24 Oct 2026). Probe record (12 Oct): routing, startup handoff, atomicity, owner lifetime, tab API. One run per probe, one storage context. Reference or dated data. Check before relying on its numbers. Register: [notes register](../../docs/notes-register.md).

Status: 2026-10-12, Chrome 154, isolated profiles, one run per probe (routing, lifetime and tabs were each run more than once while fixing the probe; the reported run is the last one). Generic extension mechanics only: no repo code. Planning input only. No shipped code changed.

Scope: the existing storage backend, with `#progress` as owner, a Worker for the state machine, and the service worker as a stateless router. Results are for Chrome. Firefox is not covered here.

## Results

### 1. Content-to-owner routing (`results-routing.json`)

A content script sends `owner-request` through `runtime.sendMessage`. The owner page answers when it holds `mb-owner`. The service worker answers `ownerAbsent` only when no owner holds the lock, after a 1 s delay so a termination can land during the reply. The content script retries every 300 ms, with a 2 s per-attempt timeout.

| Case | Attempts | Total (ms) | Outcome |
|---|---|---|---|
| Owner present | 1 | 2 | Owner answered |
| Owner absent, then started by the driver | 3 | 3,262 | Service worker answered absent twice; owner answered after start |
| Owner restarted with a reply in flight (owner delayed its reply by 1.5 s, closed at 0.3 s) | 2 | 3,839 | First attempt timed out (reply lost); retry answered |
| Service worker terminated while replying absent | 3 | 2,326 | Chrome reported "message channel closed"; retry answered |

Direct routing works in all four cases. A lost reply is visible to the sender, either as a `sendMessage` error or as a timeout. Retry recovers in each case. The retry cost is set by the owner's start time and by the timeout, not by the transport.

### 2. Startup handoff (`results-handoff.json`)

141 keys, 630 KB, 2,820 records. Ten repetitions of each variant, median:

| Step | Copy variant (structured clone) | Buffer variant (JSON, transferred) |
|---|---|---|
| Read from `storage.local` on the page | 4.4 ms | 4.8 ms |
| Encode to buffer | not needed | 3.1 ms |
| Hand over to the Worker and replay | 1.6 ms, of which 1.2 ms is replay | 2.2 ms, of which 1.9 ms is replay |

The structured-clone copy is faster than encoding to a buffer. The earlier figure of 8 to 11 ms per MB came from the service-worker-to-page message path, which serialises JSON. A page-to-Worker `postMessage` does not pay that cost at this size. Startup replay for 2,820 records is about 2 ms.

### 3. Multi-key atomicity (`results-atomic.json`)

200 iterations. Each one starts a 141-key `storage.local.set` and a 141-key `get` at the same time, and checks whether the `get` sees two different tags. Mixed reads: 0 of 200.

This tests one storage context in one process. It does not prove atomicity under every interleaving, and it does not test a second context reading concurrently. It does remove the most obvious way the pending and committed markers could be needed.

### 4. Owner lifetime (`results-lifetime.json`)

| Step | Result |
|---|---|
| Waiter queued behind the owner | Not acquired (correct) |
| Owner frozen with `Page.setWebLifecycleState` for 3 s | Lock still held; waiter not acquired |
| Owner discarded with `chrome.tabs.discard` | Lock released; waiter acquired 5 ms later |
| Replacement owner readiness (read 141 keys, replay 2,820 records) | 10 ms |

A frozen owner keeps the lock, so a waiter can't take over until the owner is discarded or thawed. That is the risk to take seriously. Chrome may freeze a hidden owner on its own, and this probe didn't test that.

### 5. Tab API from a hidden owner (`results-tabs.json`)

20 iterations each, median:

| Call | Focused | Hidden |
|---|---|---|
| `tabs.query` | 1.3 ms | 1.8 ms |
| `tabs.create` | 9.0 ms | 11.2 ms |
| `tabs.remove` | 3.9 ms | 5.7 ms |

Tab calls from a hidden owner cost about the same as from a focused one. The tab API is not the gate. The gate is holding the writer lock across waits such as tab loads, retries and UI coordination, which the design already forbids.

## What these results do not show

- Whether Chrome freezes a hidden owner on its own, and after how long. This needs a long-running test.
- Whether `chrome.tabs.discard` matches a browser-initiated discard under memory pressure.
- Routing with several owner candidates, or with the owner page's own startup racing a request.
- Atomicity across two storage contexts.
- Firefox.
- Real queue sizes and real lock-hold times (the lock-hold baseline needs the queue paused).

## Firefox (2026-10-12, `run-firefox.js`, `results-firefox.json`)

Same design, driven over Marionette. Firefox has no tab-discard API, and Marionette cannot freeze a page, so owner lifetime and service-worker termination were not run in Firefox.

| Check | Firefox result | Chrome result |
|---|---|---|
| Content script can read `storage.session` | **No.** `chrome.storage.session` is undefined in the content script | Yes (read succeeded) |
| `setAccessLevel` available to content | Not applicable (no session area in content) | Available in the service worker |
| Routing, owner present | 1 attempt, 4 ms | 1 attempt, 2 ms |
| Routing, owner absent then started | 3 attempts, 2.9 s (absent replies from the event page) | 3 attempts, 3.3 s |
| Routing, owner restarted with a reply in flight | 2 attempts, 3.4 s (reply lost, then retry) | 2 attempts, 3.8 s |
| Startup handoff, 141 keys, 2,820 records (median of 10) | read 14 ms, copy and replay 3 ms | read 4.4 ms, copy and replay 1.6 ms |
| Atomicity, 200 concurrent set-and-get trials | 0 mixed reads | 0 mixed reads |
| Tab calls from a hidden owner (median) | query 2 ms, create 18 ms, remove 8 ms | query 1.8 ms, create 11 ms, remove 6 ms |

Consequences:
- **The Firefox content-script mirror path does not exist.** Content scripts on Firefox cannot read `storage.session`, so content must reach the owner for every read. The earlier suspicion that `setAccessLevel` was the missing piece is wrong: the session area itself is absent from content scripts.
- Routing works on Firefox through the background event page, with the same retry behaviour as Chrome.
- **The Firefox background event page restarts while idle.** Its boot id changed within a 90 s idle period (`run-firefox-idle.js`, `results-firefox-idle.json`). Restarts are routine, so the service-worker role must tolerate them, as the retry already does.
- The service-worker-termination routing case was not run on Firefox. Marionette cannot force-stop an event page.

## Reproduce

```bash
node experiments/design-probes/run.js routing
node experiments/design-probes/run.js handoff 10
node experiments/design-probes/run.js atomic 200
node experiments/design-probes/run.js lifetime
node experiments/design-probes/run.js tabs 20
```

## Long run: does Chrome freeze or discard a hidden owner? (`long-freeze.js`, 2026-10-12)

One run, 35 minutes (2,100 s), 70 samples at 30 s. Owner page holds `mb-owner` in a background tab; a waiter queues behind it; a decoy tab keeps both hidden. Lifecycle and target events were logged.

| Observation | Result |
|---|---|
| Owner target destroyed (discarded or closed) | Not during the run |
| Owner unresponsive to evaluation (frozen-looking) | Never; every sample answered |
| Lock held by the owner | Held for all 70 samples |
| Waiter acquired the lock | Never |
| Lifecycle events beyond page load (`frozen`, `resumed`) | None |
| Owner heartbeat, one tick per second target | About 1 per second for the first ~5 minutes (299 at 300 s), then about 1 per minute (304 at 601 s, 329 at 2,072 s) |

Reading: Chrome throttled the hidden owner's main-thread timers to about one per minute after five minutes hidden, as in the earlier 30-minute test, but it did not freeze or discard the page, and the lock stayed with it. Caveats: one run; the owner held a Web Lock, and Chrome's freeze eligibility rules are not known, so a page without a held lock, or under memory pressure, may behave differently; timers in the owner's Worker are not throttled (see `page-throttle/NOTE.md`).
