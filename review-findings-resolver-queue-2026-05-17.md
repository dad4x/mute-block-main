# Resolver Queue Review Findings

Status: resolved review record.

Canonical planning now starts at [planning.md](planning.md). Canonical
architecture starts at [architecture.md](architecture.md). Keep this note as
historical evidence; do not use it as active planning.

Review target: queued space-feed resolver workflow in the current working tree.

Validation: review-only note. I did not run tests or rebuild artifacts.

Resolution:

- Addressed in `1.6.231`.
- Aggregate space-feed buttons now persist selected entry snapshots, so
  resolver-only entries are submitted alongside URL-backed profile entries.
- Unresolved resolver rows now clear matching resolver-pending source records.
- Validation after the fix: `npm test`, source and built-output syntax checks,
  production rebuild, Chrome/Firefox zip rebuild, Windows Chrome sync, and live
  extension reload.

## Findings

### P2: Clear resolver-pending posts on unresolved targets

When a resolver-only space post fails to resolve to a profile, `markQueuedProfileResolutionUnresolved()` marks only the key-only coordinator queue row as `skipped` (`shared/js/sw.js:6250`, `shared/js/sw.js:6284`). It does not clear the matching `mbSpacePendingNukedPosts` record that was created with `resolverPending: true` in `registerPendingSpaceFeedEntries()` (`shared/js/content.js:7680`, `shared/js/content.js:7720`).

The successful resolution path explicitly converts the pending post from resolver-pending to URL-backed pending work through `addResolvedProfileToPendingSpaceRecords()`, which sets `resolverPending: false` once a profile href exists (`shared/js/sw.js:6061`, `shared/js/sw.js:6079`, `shared/js/sw.js:6211`). The unresolved path has no equivalent pending-post update, and the terminal row has no profile href for the normal source-settlement cleanup to use.

Impact: after an unresolved source page, the post can remain permanently counted as pending resolver work. The space feed may keep showing the post or aggregate queue as busy even though the resolver queue item is already terminal.

Recommendation: in `markQueuedProfileResolutionUnresolved()`, remove or settle pending records whose `resolverUrl`/`postUrl`/source evidence matches the unresolved resolver item, and clear `resolverPending` before saving. Add coverage for a resolver-only post that records pending state, fails to resolve, and leaves no resolver-pending work behind.

### P2: Preserve resolver-only entries in aggregate clicks

The aggregate space-feed button can advertise resolver-only work through `queueableCount`, but it stores only profile URLs in the button dataset. `syncSpaceFeedTopNukeButton()` computes `displayEntryUrls` from `getDedupedSpaceFeedUrls(displayEntries)` and stores those URLs with `setSpaceFeedButtonUrls()` (`shared/js/content.js:8396`, `shared/js/content.js:8398`, `shared/js/content.js:8446`). Resolver-only entries have no profile URL yet, so they are not represented there.

On click, `getClickedSpaceFeedEntries()` takes the URL-filtered path whenever any stored button URL exists (`shared/js/content.js:8062`, `shared/js/content.js:8064`). In a mixed batch with both profile-backed candidates and resolver-only posts, that path calls `getSpaceFeedEntriesMatchingUrls()` and drops entries that have no candidate URL. The button can show `Nuke 'Em N` from `queueableCount` (`shared/js/content.js:8475`, `shared/js/content.js:8476`) but queue only the URL-backed subset.

The per-post queue path has the same shape: it stores only `aggregateUrls` on the queue button (`shared/js/content.js:8499`, `shared/js/content.js:8602`) while using `aggregateCount` for the label (`shared/js/content.js:8500`, `shared/js/content.js:8612`).

Impact: aggregate submissions can silently skip resolver-only posts whenever the same aggregate selection also contains any normal profile candidate. The visible target count and queued target count diverge.

Recommendation: persist aggregate entry identity, not only profile URLs. For example, store selected post keys plus URLs, or make `getClickedSpaceFeedEntries()` merge URL matches with resolver-only queueable entries when the button represents an aggregate space/post action. Add coverage for a mixed aggregate containing one URL-backed profile and one resolver-only post; the queued work count should include both.
