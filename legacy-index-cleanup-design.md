# Legacy index cleanup design (18 Oct 2026)

Status (updated 24 Oct 2026): shipped in 1.6.1435 to 1.6.1436 (20 Oct). Its two choices are decided (fixed list of names; session marker). The startup order differs from the first draft (section 5). The live check it needs (the first start after an update) is still pending. This note was written on 19 Oct, when the change was in the working tree only, so its line numbers are from that time.

## 1. The keys

| Family | Exact name or pattern | Count | Builder | Metric family (`shared/js/swStorageMetrics.js`) |
|---|---|---|---|---|
| Monolithic queue index | `mbCoordinatorContentQueueIndex` (exact; `COORDINATOR_CONTENT_QUEUE_INDEX_KEY`, sw.js:639) | 1 | `buildCoordinatorContentQueueIndex` (swCoordinatorContentQueueIndex.js:92) | `contentQueueIndex` (line 63, exact match) |
| Queue index shards | `mbCoordinatorContentQueueIndexShard.` + `00` to `1f` (`COORDINATOR_CONTENT_QUEUE_INDEX_SHARD_PREFIX`, sw.js:695; count 32, sw.js:696) | 32 | enumerated by `getProjectionShardKeyByIndex` (swprojections.js:13) via `makeProjectionShardDefaults` (swprojections.js:24), used in `buildCoordinatorContentQueueIndexShardPayload` (swCoordinatorContentQueueIndex.js:160). Hashed key for a profile: `getCoordinatorContentQueueIndexShardKey` (:143) | none. Falls through to `other` (line 77). Not in the production constants either (see section 11) |
| Source index shards | `mbCoordinatorContentSourceIndex.` + `00` to `1f` (`COORDINATOR_CONTENT_SOURCE_INDEX_PREFIX`, sw.js:640; count 32, sw.js:688) | 32 | enumerated by `getCoordinatorContentSourceIndexShardKeyByIndex` (swCoordinatorContentQueueIndex.js:179); hashed key by `getCoordinatorContentSourceIndexShardKey` (:187); payload by `buildCoordinatorContentSourceIndexShardPayload` (:237) | `contentSourceIndex` (line 64, prefix match) |

Total possible names: 1 + 32 + 32 = **65** (index names). Section 1a adds 66 progress names, for 131 in all.

- Suffixes are two lowercase hex digits, not decimal (`getProjectionShardKeyByIndex` pads `index.toString(16)`, swprojections.js:16). Index 10 is `0a`, index 31 is `1f`.
- Writes hash the key with `hashProjectionShardKey` (swprojections.js:1), so a given profile or source key always lands in one shard, and every name written is in the 65.
- `shared/js/storageKeys.js` (18 lines) declares none of these names. They are declared only in sw.js.
- `storageKeys.js` is the shared-names module that `test/p1-contract.test.js` guards, so these names are not covered by that guard.

## 1a. Progress keys (decision 31, 18 Oct)

Progress moves to session memory (decision 31). The old progress copy on disk goes with this cleanup. The fixed list gains 66 names, so the cleanup list is 131 names in all:

- The progress view: `mbProfileNukeProgressView` (1 name).
- The 32 progress shards: `mbProfileNukeProgressShard.` plus `00` to `1f` (32 names; the prefix is the worker's progress shard prefix).
- Their 33 namespace tokens: `mbCoordinatorNamespaceSeq.` plus each of the 33 progress key names above (33 names). These tokens are per-save stamps written to disk. Progress no longer uses tokens (decision 31), so an old token on disk is dead data.

The runs key and the outlier list keep their tokens and are not in this list. The cleanup still deletes only the names it lists, once, and never by prefix.

## 2. Why these keys are legacy

- **Working tree (no disk writer).** The derived payload is built in memory from the resident queue and cached until the queue object changes (`getResidentDerivedQueueIndexPayload`, sw.js:7890; `readResidentDerivedQueueIndex`, sw.js:7904). Its only caller in the working tree is sw.js:7895. The content-page read takes the index from that cache (sw.js:35718). The rebuild in `rebuildContentPageStateProjectionFromCurrentState` (sw.js:35671) builds the payloads and returns them without writing (sw.js:35678 to 35680). The comment near sw.js:7880 says the index and shards "are never written to storage".
- **The build in the repo still writes them.** `buildCoordinatorQueueDerivedProjectionPayload` is merged into the queue WAL save and into projection saves at HEAD (sw.js:7476, 7585, 7629, 7675, 7943, 7978 and 8148). The content-page rebuild writes the monolithic key, the queue shards and the source shards in one `metricStorageSet` at HEAD sw.js:34627 to 34631. The HEAD read path rebuilds and rewrites any shard it finds missing (HEAD sw.js:34697 to 34698). The 18 Oct build (version 1.6.1434) predates the in-memory change.
- **So any profile that ran a committed build may hold copies on disk.** Whether this dev profile still has them is not checked. The 18 Oct read-only audit method (coder instructions, section 3) can answer that.
- **No reader of these keys from storage remains in the working tree.** The only references in `shared/js` are the constants, the metric classifier, the builders and the rebuild. `shared/js/content.js` and `coordinator.js` do not name them.
- **Names are stable in committed history.** The source prefix and count of 32 are the same in every committed version checked, from de34857 (25 May 2026) to HEAD. The queue shard prefix and count first appear in edb7974 (8 Oct 2026). Commits before 25 May 2026 were not checked.

## 3. Cleanup scope: exact names only

The cleanup removes exactly the names in sections 1 and 1a (131 names). It does not match by prefix.

- Enumeration: the fixed list of the 65 index names and the 66 progress names (decision 18, and decision 31 for the progress keys). It misses a name that an older build used and that the current constants do not name. Section 2 says none was found in committed history from 25 May 2026 on.
- Build the list from the writer's own constants and helpers, passed in through `deps.constants` the same way `createCoordinatorContentQueueIndex` receives them (swCoordinatorContentQueueIndex.js:64 to 72). The list then cannot drift from the writer.
- Never use a prefix such as `mbCoordinator` or `mbCoordinatorQueue`. Those match the WAL, the queue view, runs and events (section 8).

## 4. Marker key

**Name: `mbLegacyContentIndexCleanupV1`.** The `V1` lets a later pass use a new marker.

**Where the marker lives: `chrome.storage.session`** (David, 18 Oct: nothing is written to disk). It is cleared when the browser restarts, so the cleanup runs at most once per browser session. This follows the pattern of `mbBrowserSessionMarker` (sw.js:648, read at sw.js:2021). Only the worker reads it, so `setAccessLevel` is not needed.

## 5. Order

1. Startup: after the first authority load, from the startup chain (`scheduleStoredWorkRearmAfterStartupHydrate`), not at module load. A read started at load interleaves with the first storage update of a test and changes which update its reads belong to, so the cleanup waits for the load. Nothing reads these keys from storage, so no read waits on it.
2. Read the marker. If it is set, record `skipped` and stop.
3. One read of the 131 names. Collect the names that are present, and each one's size (`getJsonByteSize`, exported by `createStorageMetrics`).
4. If none are present, write the marker and stop.
5. Remove the present names with `metricStorageRemove` (sw.js:2611). It honours `suppressAbandonedStorageOperation` (`swstorage.js:461`) and records the `storageRemove` counters. Pass only present names. Never pass absent names.
6. Only after step 5 resolves `true`, write the marker: `{version: 1, completedAt, removedCount, removedBytes}`.

Re-run safety. A crash after step 5 and before step 6 leaves no marker. The next start finds no names present, writes the marker, and removes nothing. A crash in the middle of step 5 leaves some names. The next start removes the rest.

## 6. Failure handling

- Step 3 fails or times out: no removal and no marker. Record `failed`. Wrap the read in `promiseWithTimeout` (sw.js:24819) with a named value from `shared/js/timeouts.js`. Do not add a new number, a timer or a retry loop.
- `metricStorageRemove` returns `false` (abandoned worker): no marker. Record `skipped-abandoned`.
- `metricStorageRemove` throws: no marker. Record `failed` with the error text. The recorder cuts strings at 240 characters.
- Marker write fails: the next start repeats steps 1 to 4 and writes it again. This is harmless.
- One attempt per worker start. The next start is the retry. There is no backoff.

## 7. Logging

- `recordFlightRecorderEvent({kind: 'legacy-content-index-cleanup', outcome, presentCount, removedBytes, durationMs, error})` (swflightRecorder.js:112). The recorder is memory-only and sanitizes its fields. Its snapshot (`mbFlightRecorderSnapshot`, written through `sessionMemory.setSessionValue`, sw.js:5631, at most every 10 s) goes to the session area, not to disk.
- Do not use `recordCoordinatorDiagnosticEvent`. Its flush (`flushPendingCoordinatorDiagnosticEvents`, sw.js:5723) writes `mbCoordinatorEvents` to disk. Decision 5 in the coder instructions makes the same point.
- The recorder is lost when the worker restarts. The marker, and the absence of the names, is the durable record. The storage counters from `metricStorageRemove` persist only as the usual queue-wakeup metrics.

## 8. Never touch (exact names)

The cleanup list is exactly the 131 names in sections 1 and 1a. Everything below stays.

- **Queue and WAL:** `mbCoordinatorQueue` (sw.js:425); `mbCoordinatorQueueWal` and every key under it, including its meta key (sw.js:426 to 427) and its checkpoints.
- **Runs and events:** `mbCoordinatorRuns` (storageKeys.js:9); `mbCoordinatorHiddenRunIds` (storageKeys.js:12); `mbCoordinatorEvents` (storageKeys.js:10).
- **Pending and nuked posts:** `mbSpacePendingNukedPosts` (storageKeys.js:15); `mbSpaceNukedPosts` (shared/js/nukedPosts.js:1).
- **Settings and stamps:** `mbCoordinatorPaused` (storageKeys.js:7); `mbCoordinatorRetryFailedEnabled` (:8); `mbDashboardDevModeEnabled` (:17); `mbSpaceRegistry` (:16); `mbCoordinatorLastEnqueueSummary` (:11); `coordinatorAutoStartOnBrowserStart` and `mbCoordinatorPauseGeneration` (swprefs.js:13 to 14); `mbCoordinatorStatsClearedAt` (sw.js:664); `mbCoordinatorNamespaceSeq.*` (sw.js:644), except the 33 progress tokens in section 1a.
- **Retired view:** `mbCoordinatorQueueView` belongs to `retireLegacyQueueViewStorageKey` (sw.js:35979). Keep it out of this cleanup.
- **Legacy full progress key:** `mbProfileNukeProgress` is removed by the existing version-15 retirement, not by this cleanup.
- **Prefixes to avoid:** `mbCoordinator` and `mbCoordinatorQueue` match the WAL, the view, runs and events. `mbCoordinatorContent` matches only the index families today, but use exact names regardless.

## 8a. Writer rule (20 Oct review, choice a)

No code may write any of the 131 names to `chrome.storage.local`, the disk. Progress is written to session memory under the same names, and the cleanup does not touch session memory. The cleanup runs fire-and-forget after the authority load and takes no lock. No disk writer of these names exists today, so there is no race now. A future disk writer would race the cleanup, so none may be added. David chose this on 20 Oct (item 4 in section 6 of the progress note, option a). Option b, running the cleanup inside the storage queue, was not chosen.

## 9. Test plan

Implemented on 19 Oct in `test/swSynthetic.test.js` (cases 1, 2, 3, 4, 6, 7 and 8 of the plan). Case 5 (a removal refused because its update was abandoned) is not written: an abandoned read throws in `metricStorageGet` before the removal, so the outcome is `failed` and no marker is written. That path is covered by the general abandonment tests only.

Outcomes recorded in the flight recorder: `removed`, `none-present`, `skipped-marked`, `skipped-abandoned`, `failed`, `marker-failed`.

## 10. Rollback

No rollback is needed for the derived data:

1. The keys copy the resident queue. The authority is the WAL and its checkpoints, and the list excludes all of them (section 8).
2. The working tree does not read these keys from storage (sw.js:35718 reads the resident state).
3. Any committed build rebuilds the keys on its own. HEAD rebuilds missing shards on read and rewrites them on each queue change (section 2).
4. The removal touches no authority key, so there is nothing to put back.

Residue. A rollback to HEAD writes the keys again. The session marker stops a second cleanup for the rest of the browser session, so copies that a rollback writes back stay until the next browser session starts.

## 11. Other findings (not part of this cleanup)

- **Metric gap.** `mbCoordinatorContentQueueIndexShard.*` classifies as `other` (`swStorageMetrics.js:58` to 78 falls through to line 77). The production `createStorageMetrics` call (sw.js:2311 to 2335) does not pass `COORDINATOR_CONTENT_QUEUE_INDEX_SHARD_PREFIX`. `test/swStorageMetrics.test.js` builds its own constants without it. So write metrics for the 32 queue shards land in `other`. The guard test should match by name, not by family, or add a classifier branch and pass the constant.
- **Stale docs.** `experiments/design/NOTE.md:16` to 17 still lists the index as persisted. `upgrade-regression-plan.md:188` to 190 says phase 2 may materialize these keys. `tools/cdp/upgrade-regression/run.js:209` to 210 allowlists them. The allowlist is permissive, so the cleanup does not break it.
- **Measurement.** The content-queue-index family was 210 MB of writes in the 18:00 run (coder instructions, section 3). The on-disk size is not measured here. A timed run could record `chrome.storage.local.getBytesInUse` for the 131 names before and after. That API is Chrome-only as far as this review knows. Firefox is unverified.
- **Write count.** The cleanup makes one `get` of the 131 names, then one `remove` of present names, then at most one marker write, which goes to session storage. Its only disk writes are the removals.
