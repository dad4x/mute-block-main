// Storage key names that more than one module uses. Each name is declared once, here, and imported by name. A key that only one
// module uses stays in that module. test/p1-contract.test.js fails if one of these names is declared with an assignment in any
// other shared/js module, and checks that each value is still the one it had. The values are chrome.storage keys: changing one
// orphans the data stored under it, so it needs a migration, not an edit here alone.
module.exports = {
    COORDINATOR_QUEUE_VIEW_KEY: 'mbCoordinatorQueueView',
    COORDINATOR_PAUSED_KEY: 'mbCoordinatorPaused',
    COORDINATOR_RETRY_FAILED_ENABLED_KEY: 'mbCoordinatorRetryFailedEnabled',
    COORDINATOR_RUNS_KEY: 'mbCoordinatorRuns',
    COORDINATOR_EVENTS_KEY: 'mbCoordinatorEvents',
    COORDINATOR_LAST_ENQUEUE_SUMMARY_KEY: 'mbCoordinatorLastEnqueueSummary',
    HIDDEN_RUNS_KEY: 'mbCoordinatorHiddenRunIds',
    QUEUE_WAKEUP_METRICS_VIEW_KEY: 'mbQueueWakeupMetricsView',
    PROFILE_NUKE_PROGRESS_VIEW_KEY: 'mbProfileNukeProgressView',
    PROFILE_NUKE_PROGRESS_SHARD_PREFIX: 'mbProfileNukeProgressShard.',
    // The number of progress shards, and the 1.6 layout's count, which only the legacy cleanup names (sw.js). Not a key name, but it sets the
    // key names: changing PROFILE_NUKE_PROGRESS_SHARD_COUNT reshards the session copy (the owner clears storage with a change like that).
    PROFILE_NUKE_PROGRESS_SHARD_COUNT: 256,
    LEGACY_PROFILE_NUKE_PROGRESS_SHARD_COUNT: 32,
    // The other storage layout counts (24 Oct, review Appendix C.1). Each one sets the names of stored keys. Changing one reshards the
    // data under it, so it needs a migration. The space post maps and the checkpoint shards are on disk; the content indexes are derived.
    SPACE_MAP_BUCKET_COUNT: 32,
    CHECKPOINT_SHARD_DEFAULT_COUNT: 10,
    COORDINATOR_CONTENT_QUEUE_INDEX_SHARD_COUNT: 32,
    COORDINATOR_CONTENT_SOURCE_INDEX_SHARD_COUNT: 32,
    SPACE_PENDING_NUKED_POSTS_KEY: 'mbSpacePendingNukedPosts',
    SPACE_REGISTRY_KEY: 'mbSpaceRegistry',
    DEV_MODE_SYNC_STORAGE_KEY: 'mbDashboardDevModeEnabled'
}
