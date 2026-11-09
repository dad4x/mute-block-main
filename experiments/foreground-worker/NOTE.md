# Foreground worker: origin probe

> **Status: REFERENCE** (24 Oct 2026). Origin probe (11 Oct) for the foreground worker design. Planning input. Reference or dated data. Check before relying on its numbers. Register: [notes register](../../docs/notes-register.md).

Status: run 2026-10-11 on Chrome 154, isolated profile. Planning input only. No shipped code changed.

Question: could the queue's database live in a dedicated Worker started from a foreground Quora page, instead of the MV3 service worker, so the data survives the service worker's reincarnation cycle?

## Result

A worker created from a content script (`run-cdp.js`, probe at `ext/`) runs in the **page's** origin, not the extension's:

| Check | Result |
|---|---|
| Worker from a blob URL, created by the content script | Created. Its origin is the page origin (`http://127.0.0.1:8766`). |
| OPFS file written from that worker | Landed in the **page** origin's OPFS (`probe-from-content-worker.txt` present). |
| Same file visible from the extension origin | No. The extension origin's OPFS is empty. |
| Worker from an extension URL, created by the content script | Blocked: `SecurityError`, script cannot be accessed from the page origin. |

For Quora this would mean: the queue database would sit in `quora.com` site storage, which the site can see through the same origin APIs and which is removed when the user clears Quora's site data. The worker also dies with the tab, so a "hangs around the Quora page" host has the same lifecycle problem as the service worker, with a different owner.

## What the extension origin offers instead

- The extension-origin document that already exists: the worker window (`coordinator.html#progress`, opened by `shared/js/coordinator.js`). A dedicated Worker or the main thread of that page has extension-origin storage. Its lifetime is the document's lifetime, and the service worker can see when it goes away and recreate it. That is an explicit lifecycle, not the ~30 s idle kill.
- IndexedDB works on the extension page's main thread directly, without a dedicated worker.
- SQLite with OPFS needs a dedicated worker, and that worker must be created by an extension-origin document. The offscreen-document probe in `experiments/sqlite/` tested that.

## Not tested yet

- Whether the worker window's dedicated worker survives background throttling and tab discarding, and what the reopen path costs.
- Firefox equivalents (event pages and their storage).

## Reproduce

```bash
node experiments/foreground-worker/run-cdp.js
```
