# Firefox cross-check: worker, election, broadcast

> **Status: REFERENCE** (24 Oct 2026). Firefox probe (12 Oct): worker, election and broadcast. One run. Planning input. Reference or dated data. Check before relying on its numbers. Register: [notes register](../../docs/notes-register.md).

Status: run 2026-10-12 on Firefox (Marionette, dedicated profile), one run. All numbers from `results.json`. Planning input only. No shipped code changed.

Purpose: repeat the Chrome worker, owner-election, and mirror-broadcast checks on Firefox, so the design doesn't rest on one browser.

## Results

| Check | Chrome | Firefox | Match |
|---|---|---|---|
| Dedicated worker has `chrome.*` | No | No (`typeof chrome` undefined) | Yes |
| Dedicated worker has `BroadcastChannel` | Yes | Yes | Yes |
| Dedicated worker has `navigator.locks` | Yes | Yes | Yes |
| Dedicated worker has `SharedWorker` | No | No | Yes |
| Worker origin from an extension page | `chrome-extension://…` | `moz-extension://…` | Equivalent |
| Worker from a content script writes OPFS in the page origin | Yes | Yes (file in `http://127.0.0.1:8768` origin, absent from extension origin) | Yes |
| Election: exactly one waiter takes over after the holder closes | Yes, handover about 5 ms | Yes, handover about 4 ms | Yes |
| Election: late holder refused while lock held | Yes | Yes | Yes |
| Steady broadcast to two viewer pages | 300 of 300 each, mean lag 0.3 ms | 300 of 300 each, mean lag 0.3 ms | Yes |
| Steady `storage.session` events to a viewer page | 300 of 300, mean lag 0.5 ms | 300 of 300, mean lag 1.3 ms | Yes |
| Background event page or service worker hears all broadcasts | 300 of 300 | 300 of 300 | Yes |
| Late joiner misses earlier messages; mirror read on join gives current seq | Yes (seq 394 to 600 received) | Yes (seq 362 to 600 received, mirror seq 600) | Yes |
| Owner handover, new epoch from seq 1, no gaps | Yes | Yes (epoch 2 seq 1 to 100, no gaps) | Yes |
| **Content script receives `BroadcastChannel`** | No (0) | No (0) | Yes, as expected |
| **Content script receives `storage.session` change events** | **Yes (300 of 300, mean lag 0.6 ms)** | **No (0 of 300)** | **No** |

## The difference that matters

The content script on a Firefox page received none of the 300 `storage.session` change events. There was no listener error, and the same content script on Chrome received all 300.

Confirmed in a follow-up probe (`experiments/design-probes/NOTE.md`, Firefox section): on Firefox, `chrome.storage.session` is undefined in the content script. The session area is not available to content scripts at all, so a missing `setAccessLevel` is not the cause. Content scripts on Firefox must reach the owner for any mirror read.

Consequence for the design: the content-script read path for the mirror (the one that depends on `storage.session` change events) works on Chrome and is unproven on Firefox. The fix would be either a Firefox-specific content path (for example, a worker-window or service-worker relay), or a check that content can read `storage.session` on Firefox at all.

## Other differences

- **Background.** Firefox runs the background as an event page, not a service worker, so the service-worker stop phase from the Chrome run was not repeated. Marionette has no equivalent of `ServiceWorker.stopAllWorkers`. The event page stayed alive through the bursts, because its storage listener kept receiving events.
- **Blob workers.** In the throttling probe, a worker built from a `blob:` URL failed inside a Firefox extension page with a generic `worker error`. The probe used a worker file instead. The worker-origin test above used a blob worker inside a content script and succeeded there. So the failure is specific to the extension page context.
- **Late joiner count.** Firefox's late joiner received 239 messages where Chrome received 207. Timing varies between runs; both joined mid-burst and missed their earlier messages.

## Reproduce

```bash
SPIKE_MARIONETTE_PORT=2840 node experiments/firefox-validation/run-validations.js > experiments/firefox-validation/results.json
```

Earlier Firefox throttling runs (short and 30-minute) are recorded in `experiments/page-throttle/NOTE.md`.
