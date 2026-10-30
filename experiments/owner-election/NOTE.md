# Owner election across extension pages (Web Locks)

> **Status: REFERENCE** (24 Oct 2026). Probe (11 Oct): owner election across extension pages with Web Locks. Planning input. Reference or dated data. Check before relying on its numbers. Register: [notes register](../../docs/notes-register.md).

Status: run 2026-10-11 on Chrome 154, isolated profile. Planning input only. No shipped code changed.

Question: several extension pages may be open (`#progress`, `#dashboard`, `#preferences`, and possibly a second `#progress`). Only one may own the queue worker. Can Web Locks do the election, and what is `storage.session` for?

## Result (`results.json`)

| Check | Result |
|---|---|
| One holder takes an exclusive lock, two waiters queue | Holder acquired; both waiters waiting. |
| Holder page closed | Exactly one waiter acquired the lock, about 5 ms after close. The other kept waiting. |
| Late page requests the lock with `ifAvailable` while it is held | Refused (`not-available`). |

The browser releases the lock when the page holding it goes away, so no heartbeat or expiry is needed to recover from a crash or a close.

## Roles

- `#progress`: owner candidate. Always present, so it's the natural owner.
- `#dashboard`, `#preferences`: viewers only. They never request the owner lock.
- Any `#progress` page that isn't the owner waits on the lock and takes over on handover.

## What `storage.session` is for

- **Not for mutual exclusion.** `chrome.storage` has no compare-and-set, and nothing is released automatically when a page dies. A "claim" key would need heartbeats and expiry, which reintroduces stale-owner windows.
- **For publishing.** The owner writes `{ownerId, epoch}` after it acquires the lock. The lock makes it the only writer, so the write needs no compare-and-set. Readers use the epoch to decide whether the mirror belongs to the current owner.
- **Cleared on browser restart.** Locks are also gone then, so there's no stale epoch to reconcile.

## Open items

- Viewer-to-owner messaging. `BroadcastChannel` is available in extension contexts (checked in the SQLite probe), but cross-page delivery hasn't been tested. `runtime.sendMessage` reaches every extension page, so each listener would have to filter by owner ID.
- Whether a discarded or frozen page releases its lock. Closing releases it (tested); discarding has not been tested.

## Reproduce

```bash
node experiments/owner-election/run-cdp.js
```
