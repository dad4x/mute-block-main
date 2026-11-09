# Bug: orphaned queued-executor tabs with no durable record, caught live 2026-09-19

> **Status: HISTORICAL** (24 Oct 2026). Bug record (19 Sep): orphaned executor tabs with no durable record. Later orphan fixes shipped (1.6.1441). The original report was not re-checked live. Kept as a record. Do not implement from it. planning.md is the front door. Register: [notes register](../docs/notes-register.md).

Found while live-tracing the handoff-latency issue in `handoff-2026-09-19.md`.
Not yet root-caused -- this doc is the captured evidence so the next session
doesn't have to re-derive it (the flight recorder is in-memory only and had
already reset by the time this was written up; the durable storage snapshot
below is the only surviving record).

## Symptom

Three real, fully-loaded Quora profile tabs open simultaneously in the same
browser window, all pointed at the same profile
(`https://www.quora.com/profile/Cesc-Fabregas-56`), not progressing. User
noticed live ("current run has three tabs up for ...Cesc-Fabregas-56 that
aren't progressing") and paused the queue.

## What the durable storage shows (captured via CDP, `chrome.storage.local`)

**The three live tabs:**

| tabId | windowId | active | status | title |
|---|---|---|---|---|
| 823757810 | 823757641 | true | complete | (24) Cesc Fabregas - Quora |
| 823757840 | 823757641 | false | complete | (22) Cesc Fabregas - Quora |
| 823757843 | 823757641 | false | complete | (22) Cesc Fabregas - Quora |

All three are genuine, successfully-rendered Quora pages (confirmed by
reading `document.title`/`document.body.innerText` directly -- real profile
content, "Currently coaching fc como in Italian league...", not a redirect
or error page). All three share the same `windowId` (823757641).

**Content script marker check** (`document.querySelector('[data-mb-content-script]')`
and `window.__mbContentScriptVersion`) came back `false`/`undefined` on all
three -- the extension's content script does not appear to be
present/marked on any of them. (Caveat: this was a quick ad-hoc marker
check, not the extension's own internal readiness probe -- worth
re-verifying against whatever `probe.marker` actually checks in
`ensureQueuedTabContentScript`, shared/js/sw.js, before treating "no content
script" as fully confirmed.)

**Durable bookkeeping check** -- searched ALL 32 progress shards
(`mbProfileNukeProgressShard.00` through `.1f`) and the full
`mbCoordinatorQueueView` (1856 items, not truncated):

- **Zero** progress records anywhere have `profileHref` matching
  `Cesc-Fabregas-56`. This profile was never itself a coordinator queue
  item/target.
- **Zero** queue-view items reference `Cesc-Fabregas-56` as
  `targetProfileHref` or `requestedUrl`.
- **Zero** progress records or queue items have a `tabId` matching any of
  the three live tab IDs (810, 840, 843). The coordinator's durable state
  has no reference to any of these three tabs at all -- they are fully
  orphaned from its bookkeeping.

**One suggestive anomaly found**, not matching any of the three live tabs
but potentially related: a progress record for a *different* profile,

```
key/profileHref: https://www.quora.com/profile/ISHOLA-SARAFA-OYEWOLE
status: tab-opening
tabId: 823757811          <- adjacent to tab 823757810, but not one of the 3 live tabs
lastUrl: https://www.quora.com/profile/Cesc-Fabregas-56   <- mismatch
actionSurfaceMode: worker-window
actionSurfaceWindowId: 823757641   <- same windowId as the 3 orphaned tabs
runId: space-feed-1789829830932-34q5wv
attemptId: attempt-1789829848474-w5nkuu
attemptNumber: 1
queuedAt: 1789829847964
tabCreatedAt / tabOpenedAt: 1789872906254
updatedAt: 1789874210057
terminalAt: 0
```

This record's own target (`ISHOLA-SARAFA-OYEWOLE`) does not match its
`lastUrl` (`Cesc-Fabregas-56`) -- either a genuine cross-item URL-commit
bug, or an artifact of the shared `worker-window` action surface's
last-observed-URL bleeding into an unrelated record's `lastUrl` field.
Not distinguished yet. Its own tabId (823757811) is not among the three
currently-open tabs, so whatever tab it refers to is already gone/replaced.

**Also noted, possibly unrelated:** `mbCoordinatorPaused` read back as
`false` in storage at the time of this capture, despite the user having
just paused the queue in the dashboard moments earlier. Could be a
propagation lag (async write not yet landed) rather than a bug -- not
investigated further before this write-up.

## Why this matters

`swexecutor.js` already has a deliberate guard against exactly the
"tab landed on the wrong URL" class of bug --
`ensureCreatedQueuedTabCommittedToExpectedUrl` in
`shared/js/swexecutor.js`: after `browser.tabs.create`, it polls
(`waitForQueuedTabExpectedOpenUrl`) to confirm the tab's *observed* URL
matches the *expected* target, force-navigates via
`browser.tabs.update(tabId, {url: expectedUrl})` if it hasn't committed
within the timeout, and throws `queued-tab-open-url-not-committed` if it
still hasn't committed after that. Given that guard exists, one of two
things is true and needs to be told apart:

1. That guard isn't wired into whichever code path created these three
   tabs (so the mismatch/leak is unguarded there), or
2. The guard ran, threw, and the *caller* handling that thrown error
   abandoned the mismatched tab without closing it -- leaking it -- instead
   of cleaning it up, and then opened a fresh tab for a retry (which is
   consistent with three separate leaked tabs accumulating over time in the
   same window).

Separately (found in the same investigation, see
`project_queue_handoff_reliability_investigation.md` in Claude's memory for
this repo): two *different* queue items (`Amy-Adams-1113`, `Enderking-13`)
were independently observed cycling through 7+ full tab-reopens each via the
retry/rollback machinery
(`requeueDurableActiveCoordinatorItemWithoutActor` /
`recoverExhaustedRolledBackQueuedCoordinatorItem` in `shared/js/sw.js`)
without the old tab reliably getting closed before the new one opened.
This Cesc-Fabregas-56 orphaning is very plausibly the same underlying
cleanup gap, just caught mid-flight with the *wrong* URL angle added on top
via the `ISHOLA-SARAFA-OYEWOLE` record -- but that link is not confirmed,
only suspected.

## Next steps to actually root-cause this

1. Re-run a live batch, watch the flight recorder in real time
   (`node tools/cdp/flight-recorder.js --extension-id <id> --kind
   tab-open-request`, or similar) so a fresh occurrence's trace survives
   long enough to read *before* a service-worker idle-restart wipes it
   (this session lost the original trace that way -- capture promptly).
2. Confirm whether `ensureCreatedQueuedTabCommittedToExpectedUrl` is
   actually invoked on the code path that opens `worker-window`/foreground
   action-surface tabs specifically (grep its call sites in `sw.js` against
   whatever calls `createQueuedExecutorBrowserTabEffect` for
   `actionSurfaceMode: 'worker-window'` items) -- confirm or rule out
   explanation #1 above.
3. If it is invoked, find where a thrown `queued-tab-open-url-not-committed`
   (or the broader retry/rollback path) is caught, and check whether that
   catch closes the mismatched/stale tab before retrying -- confirm or rule
   out explanation #2.
4. Separately verify whether `mbCoordinatorPaused` reading `false`
   immediately after a user-initiated pause is a real propagation-lag bug
   or just this capture's timing.

## Live extension details at capture time

- Extension ID (this session's running instance): `kmnnjpcadjhphekdimhpihnaghbbpbhe`
  (note: differs from `tools/cdp/lib/cdp.js`'s `DEFAULT_EXTENSION_ID` --
  confirm via `curl http://127.0.0.1:9222/json/list` rather than assuming).
- Version at capture time: 1.6.1276 (just-deployed fan-out fix from this
  same session, unrelated to this bug).
- Run ID: `space-feed-1789829830932-34q5wv`.
