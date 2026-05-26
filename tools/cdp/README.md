# CDP Helper Dictionary

Use these helpers for live Windows Chrome validation through the reverse CDP
tunnel. Do not regenerate one-off versions in `/tmp` unless a probe is truly
experimental and not worth preserving.

Defaults:

- CDP endpoint: `127.0.0.1:9223`
- Extension id: `ajcjckiafbnhioeafaejlaehkmdcdeha`
- Override with `--host`, `--port`, `--extension-id`, or the matching
  `MB_CDP_HOST`, `MB_CDP_PORT`, `MB_EXTENSION_ID` environment variables.

## Dictionary

| Script | Purpose | Typical command |
| --- | --- | --- |
| `tools/cdp/reload-extension.js` | Reload the unpacked extension from `chrome://extensions/`, reopen/find the Dashboard in the background, and report version plus extension errors/warnings. Requires `chrome://extensions/` to already be open. | `node tools/cdp/reload-extension.js` |
| `tools/cdp/space-summary.js` | Summarize all open Quora space tabs and service-worker space/queue state. | `node tools/cdp/space-summary.js` |
| `tools/cdp/reload-space-tabs.js` | Reload all open Quora space tabs without creating new tabs. | `node tools/cdp/reload-space-tabs.js` |
| `tools/cdp/inspect-space-state.js` | Inspect one space by URL/title substring, including source-page controls, pending post records, queue rows, and worker ownership. | `node tools/cdp/inspect-space-state.js --needle theobvioustrollshootinggallery` |
| `tools/cdp/space-contributors.js` | Inspect, open, or nuke the visible contributor modal for one space tab without switching to profile targets. | `node tools/cdp/space-contributors.js --needle itsoktobewhite --action open-and-nuke` |
| `tools/cdp/queue-summary.js` | Summarize coordinator queue/run state and open profile tabs, optionally filtered by source/target text. | `node tools/cdp/queue-summary.js --needle itsoktobewhite` |
| `tools/cdp/queue-counts.js` | Compact persisted queue counts plus open profile tabs for quick monitoring. | `node tools/cdp/queue-counts.js --needle profile-modal` |
| `tools/cdp/queue-failures.js` | List failed persisted queue rows and their error text for a source/target needle. | `node tools/cdp/queue-failures.js --needle profile-modal` |
| `tools/cdp/inspect-queue-item.js` | Inspect full queue/progress/runtime state for queue rows matching a target/source/error needle. | `node tools/cdp/inspect-queue-item.js --needle Elon-Musk-1641 --limit 1` |
| `tools/cdp/inject-content-script.js` | Inject the packaged content script and CSS into matching live Quora profile tabs from an extension page, without foregrounding the tabs. | `node tools/cdp/inject-content-script.js --needle Elon-Musk-1923` |
| `tools/cdp/queue-storage-summary.js` | Summarize persisted coordinator queue/run state from an extension page when the service worker is asleep. | `node tools/cdp/queue-storage-summary.js --needle profile-modal` |
| `tools/cdp/queue-wakeup-metrics.js` | Summarize persisted queue wakeup/storage metrics from extension storage, or analyze an exported metrics JSON file. | `node tools/cdp/queue-wakeup-metrics.js` |
| `tools/cdp/requeue-failures.js` | Requeue failed persisted queue rows matching a needle through the extension service worker. | `node tools/cdp/requeue-failures.js --needle profile-modal --max-concurrent 1` |
| `tools/cdp/target-summary.js` | Summarize open CDP targets without evaluating page or worker JavaScript. Useful when the page or service worker is busy. | `node tools/cdp/target-summary.js` |
| `tools/cdp/close-profile-tabs.js` | Close open Quora profile page targets, optionally filtered by URL/title text. | `node tools/cdp/close-profile-tabs.js` |
| `tools/cdp/requeue-stale-active.js` | Requeue persisted active rows for a needle only when no live Quora profile tabs are open. Useful after a service-worker restart strands active rows. | `node tools/cdp/requeue-stale-active.js --needle profile-modal` |
| `tools/cdp/open-queued-storage-tabs.js` | Open a small batch of persisted queued rows as inactive profile tabs from an extension page, bypassing an asleep queue pump while preserving the durable claim path. | `node tools/cdp/open-queued-storage-tabs.js --needle profile-modal --limit 1` |
| `tools/cdp/resume-queue.js` | Ask the extension service worker to resume persisted coordinator queue work, unpausing first when Current Work is paused. | `node tools/cdp/resume-queue.js` |

Keep live UI driving on raw CDP. Puppeteer is intentionally not part of this
tool directory.
