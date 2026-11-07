# Page throttling: foreground vs background

> **Status: REFERENCE** (24 Oct 2026). Probe (11 Oct): foreground versus background page throttling. Planning input. Reference or dated data. Check before relying on its numbers. Register: [notes register](../../docs/notes-register.md).

Status: run 2026-10-11 on Chrome 154, isolated profile, two extension pages in one window, 15 s per phase. Planning input only. No shipped code changed.

Question: if the queue ran in the progress dashboard page instead of a service worker or a separate window, would it keep pace when the dashboard is in the background?

## Result (`results.json`)

Tick rates, target 10 per second:

| Phase | Page main thread | Dedicated worker started from the page |
|---|---|---|
| Foreground | 10.0 /s | 10.0 /s |
| Background (hidden tab) | 1.0 /s | 10.0 /s |

Hidden pages have their main-thread timers throttled to about 1 per second, a tenth of the foreground rate. A dedicated worker started from the same page was not throttled in the same window.

## 30-minute run, Chrome 154 (`run-long.js`, `long-run.csv`, `long-run-summary.json`)

One foreground tab and one hidden tab, each with a 100 ms main-thread timer and a 100 ms worker timer. 181 samples, 10 s apart. Per 5-minute segment:

| Segment | Foreground page | Foreground worker | Hidden page | Hidden worker |
|---|---|---|---|---|
| 0 to 5 min | 10.00 /s | 10.01 /s | 0.99 /s | 10.01 /s |
| 5 to 10 min | 10.00 /s | 9.99 /s | 0.02 /s | 10.01 /s |
| 10 to 15 min | 10.00 /s | 10.01 /s | 0.02 /s | 9.99 /s |
| 15 to 20 min | 8.82 /s | 9.99 /s | 0.02 /s | 10.01 /s |
| 20 to 25 min | 10.00 /s | 10.01 /s | 0.02 /s | 9.99 /s |
| 25 to 30 min | 10.00 /s | 9.99 /s | 0.02 /s | 10.01 /s |

- The hidden page's timer drops at about 300 s, from about 1 tick per second to about 1 tick per minute (ticks at 320 s, 380 s, and so on). That is Chrome's intensive throttling, which applies after five minutes hidden. It holds for the rest of the run.
- The hidden worker stayed at 10 per second for all 30 minutes.
- The foreground page had one dip to 8.82 per second in the 15 to 20 minute segment. Its cause isn't known from this run.

For a long-running queue, this means any main-thread timer in a hidden page runs once a minute after the first five minutes. Timers in a dedicated worker are unaffected.

## Firefox cross-check (`run-firefox.js`, `results-firefox.json`)

Firefox 15-second phases, driven over Marionette, same probe as Chrome:

| Phase | Page | Worker |
|---|---|---|
| Foreground | 9.99 /s | 9.95 /s |
| Background | 0.93 /s | 9.93 /s |
| Foreground (second tab) | 9.92 /s | 9.97 /s |
| Background (second tab) | 1.00 /s | 9.97 /s |

### Firefox 30-minute run (`run-firefox.js long`, `long-run-firefox.csv`, `long-run-firefox-summary.json`)

Same probe and sampling as the Chrome run, 181 samples:

| Segment | Foreground page | Foreground worker | Hidden page | Hidden worker |
|---|---|---|---|---|
| 0 to 5 min | 9.92 /s | 9.91 /s | 0.99 /s | 9.91 /s |
| 5 to 10 min | 9.93 /s | 9.94 /s | 1.00 /s | 9.94 /s |
| 10 to 15 min | 9.94 /s | 9.94 /s | 0.99 /s | 9.94 /s |
| 15 to 20 min | 9.93 /s | 9.94 /s | 1.00 /s | 9.94 /s |
| 20 to 25 min | 9.94 /s | 9.94 /s | 0.99 /s | 9.94 /s |
| 25 to 30 min | 9.93 /s | 9.94 /s | 1.00 /s | 9.94 /s |

The hidden page stays at about 1 tick per second for all 30 minutes. There is no step to one tick per minute at five minutes, as Chrome shows. The worker holds at 9.9 per second in both tabs. So the Chrome intensive-throttling step is Chrome-specific, at least at this hidden duration.

The results match Chrome. One difference in the setup: a worker built from a `blob:` URL failed in a Firefox extension page with a generic `worker error`, so the Firefox probe loads its worker from a file (`ext-firefox/worker.js`). The 30-minute Firefox run is in progress.

## Not covered

- Minimised windows, which may differ from a hidden tab.
- Whether event callbacks from `chrome.tabs` and `chrome.storage` are delayed in a hidden page. Timers were measured, not API callbacks.
- Discarding of hidden tabs under memory pressure.

## Reproduce

```bash
node experiments/page-throttle/run-cdp.js 15
```
