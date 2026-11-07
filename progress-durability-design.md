# Progress in session memory (section 5D)

Status (updated 24 Oct 2026): shipped in 1.6.1435 (commit `8b245a1`, 20 Oct). Decisions 27, 28, 31 and 32 (coder instructions) hold. The live checks listed in the coder instructions are still pending. This note was written on 19 Oct, when the change was in the working tree only. The superseded reader inventory and findings from 18 Oct are in `historical/clear-history-2026-10-18.md`, section 10.1.

Line numbers move; search by function name.

## 1. What holds progress now

- **Disk.** No progress key. The view (`mbProfileNukeProgressView`) and its 32 shards (`mbProfileNukeProgressShard.00` to `1f`) are not written to `chrome.storage.local`. The old copies on disk are removed once by the legacy cleanup (section 4).
- **Session memory.** The same keys live in `chrome.storage.session`. The door writes them: `persistCoordinatorStoredChange` splits a stored payload, keeps the disk part for the disk write, and sends the progress part to `writeProfileNukeProgressSession`.
- **Resident copy.** Every reader in the worker (content page state, the rebuild and repair, row events, terminal settlement) reads the resident copy, as before. The copy is loaded at hydrate.
- **Hydrate.** `readCoordinatorSessionForHydrate` reads the mirror's marker and the progress keys in one session call. The mirror read that follows is the same as before. There is no separate progress read and no extra await.
- **Restart.** Progress survives a worker restart within the browser session. Closing the browser clears it (decision 28: accepted).

## 2. Decisions in force

- **D1 (b): the session copy is the only copy.** Decision 31.
- **D2 (a): content gets progress by message only.** The content page asks the worker for its scoped state, as before. The `onChanged` trigger in content is gone. Approved by David on 18 Oct.
- **D13 (b): the worker pushes on change.** After each successful progress session write, the worker sends `profile-nuke-progress-changed` to the tabs that asked for page state. Content answers by asking again for its scoped state. Approved 18 Oct.
- **D12 (a): Chrome first, Firefox on the message path.** Content does not read `storage.session`. Approved 18 Oct.
- **D10 (decision 32, route a): tools read through the worker.** The worker answers `get-profile-nuke-progress` with the worker's progress copy, loaded the way the other progress readers load it. Approved 18 Oct. No tool uses it yet (section 3).
- **D11 (decision 31): the old copy goes with the legacy cleanup.**

Choices made in code on 19 Oct, to confirm with David (none is a protocol choice):

- A failed first session read at hydrate fails the authority load. An empty copy would be saved over the real progress by the next write. This matches what a failed disk read already does.
- Session storage missing at hydrate also fails the load, for the same reason. Every supported browser has it.
- A session write that the area refuses (answers false) is "not saved". A session write that throws goes to the same storage-error path as a disk write.
- The worker's storage listener ignores a removal of the progress view. A removal is not a progress change, and the legacy cleanup removes the old copy at startup. Writes from outside the worker are still merged (D5 (b) below).
- The legacy cleanup runs after the first authority load, not at module load. Section 4 has the reason.

## 3. Open items

- **D4 (rebuild gate), not decided.** The version check still runs against the resident view. Options: (a) keep it (current); (b) a resident "loaded" flag set by the shard load; (c) drop the rebuild and rely on the shard check alone.
- **D5 (worker storage listener), not decided.** The listener still merges a progress-view write that comes from outside the worker. Options: (a) remove it; (b) keep it for writers outside the worker, such as a test seed or a tool (current); (c) keep it and log any change that reaches it.
- **D8 (repair path), not decided.** The repair still writes changed keys through the door, so its writes go to session memory. Options: (a) keep the repair, rewritten for the WAL; (b) keep it only for the one-time cleanup; (c) keep it as it is (current).
- **D9 (shard layout), not decided.** Current: 32 shards with the same prefix. Options: (a) keep; (b) change the count or prefix, which needs a key migration.
- **D3 (size of the content copy), not decided.** Content gets the scoped response from its page-state request, which is the records for the page's own hrefs, so today it is option (b) below. Options: (a) the full capped view (1,200 summaries); (b) only the records for the page's own hrefs (current); (c) a smaller summary (needs D6).
- **D6 (summary shape), not decided.** Options: (a) keep the summary as it is (current); (b) hold full records in memory and send summaries only in messages; (c) a smaller summary with only the fields content reads. (c) needs the list of fields content reads, which has not been made.
- **D7 (total, truncated, recordLimit), not decided.** The view's metadata is read by the page-state check and by a diagnostic script. Options: (a) recompute it on load from the shards; (b) keep it in memory only (current); (c) drop it, which changes the page-state check and the diagnostic.
- **Restart and the push, choice needed.** The set of tabs to push to is held in worker memory, as the queue bar's is. After a worker restart, a tab gets pushes again after its next page-state request. Options: (a) accept this, as the bar does; (b) keep the tab ids in session memory too.
- **Session quota: the whole session area, not only progress (the main risk).** Chrome's session limit is 10 MiB. On the 18 Oct dev dump: progress is about 5.35 MiB (the view and the shards), the queue WAL copy the session mirror keeps is about 3.2 MiB, and the runs copy about 0.2 MiB. The flight-recorder snapshot adds up to about 0.5 MiB. That is about 9.2 MiB before the other session keys, so the headroom is under 1 MiB. If a session write hits the limit, progress saves report "not saved". The Firefox limit is not verified. Measure the total on a live profile (`storage.session` bytes in use) before shipping. Options if it is too close: (a) shrink the progress records (D6 below); (b) keep the WAL copy on disk only (changes the mirror design); (c) cap the shards.
- **Firefox.** `storage.session` is available to extension pages from Firefox 115 (compatibility data). Content cannot read it, so content uses messages. No live Firefox check has been run.
- **Tools that still read the disk keys.** Thirteen diagnostic scripts in `tools/cdp` read `mbProfileNukeProgressView` (and the shards) from disk: `audit-action-kinds.js`, `clear-coordinator-test-state.js`, `enqueue-visible-profile-search.js`, `inspect-queue-brief.js`, `inspect-queue-item.js`, `inspect-recovered-queue-item.js`, `inspect-space-state.js`, `queue-storage-summary.js`, `queue-summary.js`, `sw-queue-summary.js`, `wal-snapshot-benchmark.js`, `storage-read-profile.js`, and `upgrade-regression/run.js`. Each should ask the worker for `get-profile-nuke-progress` instead. None can be checked without a live run.

## 4. Where the code is

- Writes: `persistCoordinatorStoredChange` (split), `writeProfileNukeProgressSession`, `profileNukeProgressPush` (after a successful progress write).
- Hydrate: `loadCoordinatorCurrentAuthorityState`, `readCoordinatorSessionForHydrate`, `readValidCoordinatorQueueMirrorFromSession`.
- Content: `getContentPageCoordinatorState` (subscribes the sender's tab), `shared/js/swProfileNukeProgressPush.js` (the module and its two action names), `content.js` (the push case in `onMessage`).
- Worker listener: `handleStorageChanged` in `swBootstrap.js` (the removal guard).
- Tools' read: `get-profile-nuke-progress` in `swBootstrap.js`, gated with the other authority reads.
- Legacy cleanup: `retireLegacyContentIndexKeys` and `getLegacyContentIndexCleanupNames` in `sw.js`. It is called from the startup chain after the authority load. Design: `legacy-index-cleanup-design.md`.
- Tests: `test/swProfileNukeProgressPush.test.js` (the module); the progress and cleanup tests in `test/swSynthetic.test.js`; the contract test for the session copy in `test/p1-contract.test.js`. The harness (`test/lib/swHarness.js`) moves progress seeds into the session copy and gives tests a storage view that reads progress from there. `progressOnDisk: true` keeps a seed on disk, for the cleanup tests.

## 5. Verify before shipping (live, not done)

- The first start after the update removes the old disk copies once, and the progress view starts empty. Expected, and accepted (decision 28).
- Content pages update after a progress change, without a reload.
- The session quota on a live profile, against the 10 MB limit.
- Firefox: content gets progress by message, and the push reaches the tabs.


## 6. Open after the 20 Oct review

Decided by David on 20 Oct ("go with your recommendations"), and done (the record is in `historical/clear-history-2026-10-18.md`, section 14): the tool read, the direct progress save and the fallback base of the progress merge now read the stored copy; the storage listener's progress arm and its wiring are gone; a stored write reports each part, and a refused disk part stops the progress write; the push drops a tab only when that tab has not subscribed again; the shard prefix is declared once, in the shared key module; the legacy cleanup routes its marker through one reader and one writer and has a named read timeout.

Still open. Each item lists its options; none is decided.

1. **The module-level copy (patterns 0 and 1).** Chosen 20 Oct: remove it, and update the stored copy at the same moment the old copy is updated today (option A). First step done 20 Oct: a queue-only executor pass reads the live progress, not the copy taken at startup (tested). Next: the in-memory copy itself (coder file, section 0a).
2. **Accessor named for the wrong owner (pattern 7).** `getCoordinatorQueueMirrorSessionArea` now serves progress and the cleanup too. Options: (a) rename across the worker file; (b) leave it. Chosen on 20 Oct: (b), to keep the live-test diff small. Revisit with item 1.
3. **Stale comment in the repair.** Fixed 20 Oct (comment only).
4. **The cleanup has no lock (pattern 4).** Decided 20 Oct: option (a). The rule is written at the cleanup and in the legacy cleanup design note, section 8a.
5. **Pre-existing timing race (pattern 4).** Fixed 20 Oct (David: go). A startup read that began before a Clear All Stats does not restore the cache it read. A test covers it, and it fails without the guard.
6. **Diagnostic scripts repeat the literal progress key names (pattern 6).** Twelve of thirteen read progress by message (20 Oct). The storage profiler measures the disk on purpose. The upgrade regression's before-and-after progress check needs David's expectation (coder file, section 0a).
7. **Case 5 of the cleanup tests.** Not written (the coder instructions, section 0, item 6).
