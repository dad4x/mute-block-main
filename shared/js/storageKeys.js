// Every chrome.storage key name the worker and its pages use. Each name is declared once, here, and imported by name; no module
// declares a storage key name of its own. test/p1-contract.test.js fails if one of these names is declared with an assignment in
// any other shared/js module, and checks that each value is still the one it had. The values are chrome.storage keys: changing one
// orphans the data stored under it, so it needs a migration, not an edit here alone. Alarm names are not storage keys and stay in sw.js.
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
    // data under it, so it needs a migration. The checkpoint shards are on disk; the content indexes are derived.
    CHECKPOINT_SHARD_DEFAULT_COUNT: 10,
    COORDINATOR_CONTENT_QUEUE_INDEX_SHARD_COUNT: 32,
    COORDINATOR_CONTENT_SOURCE_INDEX_SHARD_COUNT: 32,
    SPACE_REGISTRY_KEY: 'mbSpaceRegistry',
    // The one-time import of the 1.5 space classifications (27 Oct). Written in the same write as the imported registry, so it exists
    // only once the import has run. The 1.5 registry itself is read under its plain name SPACE_REGISTRY_KEY, outside this layout.
    SPACE_REGISTRY_IMPORT_MARKER_KEY: 'mbSpaceRegistryImportedFromV15',
    DEV_MODE_SYNC_STORAGE_KEY: 'mbDashboardDevModeEnabled',
    // The last or current continuous work: its start, and its end once it has ended (24 Oct). Read by the dashboard's Current Work header.
    COORDINATOR_WORK_SESSION_KEY: 'mbCoordinatorWorkSession',
    // The build that last ran against this storage: the running manifest version (for example 1.6.1626). The worker checks it at install
    // and at startup, and runs the upgrade step when it differs (sw.js checkStorageBuild).
    STORAGE_BUILD_KEY: 'mbStorageBuild',
    // Key names for the modules above (moved here so every storage key name is declared in one file).
    SPACE_SORT_KEY: 'mbSpaceSortBy',
    COORDINATOR_PAUSE_GENERATION_KEY: 'mbCoordinatorPauseGeneration',
    OWNED_TAB_STATE_KEY: 'mbOwnedTabIdsByParent',
    COORDINATOR_QUEUE_KEY: 'mbCoordinatorQueue',
    COORDINATOR_QUEUE_WAL_KEY: 'mbCoordinatorQueueWal',
    COORDINATOR_CONTENT_QUEUE_INDEX_KEY: 'mbCoordinatorContentQueueIndex',
    COORDINATOR_CONTENT_SOURCE_INDEX_PREFIX: 'mbCoordinatorContentSourceIndex.',
    COORDINATOR_NAMESPACE_SEQ_KEY_PREFIX: 'mbCoordinatorNamespaceSeq.',
    QUEUE_WAKEUP_METRICS_KEY: 'mbQueueWakeupMetrics',
    BROWSER_SESSION_MARKER_KEY: 'mbBrowserSessionMarker',
    QUORA_RUNTIME_ACTIVATED_SESSION_KEY: 'mbQuoraRuntimeActivated',
    FLIGHT_RECORDER_SESSION_KEY: 'mbFlightRecorderSnapshot',
    QUEUED_ACTION_SURFACE_STATE_KEY: 'mbQueuedActionSurfaceState',
    COORDINATOR_STATS_CLEARED_AT_KEY: 'mbCoordinatorStatsClearedAt',
    COORDINATOR_OUTLIERS_KEY: 'mbCoordinatorOutliers',
    COORDINATOR_TAB_KEY: 'mbCoordinatorTabId',
    COORDINATOR_CONTENT_QUEUE_INDEX_SHARD_PREFIX: 'mbCoordinatorContentQueueIndexShard.',
    PAUSE_DIAGNOSTIC_SNAPSHOT_KEY: 'mbPauseDiagnosticSnapshot',
    DEBUG_RUN_AUTOSAVED_ID_KEY: 'mbDebugRunAutosavedId',
    COORDINATOR_QUEUE_VIEW_TIMING_CACHE_SESSION_KEY: 'mbCoordinatorQueueViewTimingCache',
    COORDINATOR_QUEUE_WAL_SEQ_SESSION_KEY: 'mbCoordinatorQueueWalSeq',
    ERASE_BLOCK_HISTORY_PENDING_KEY: 'mbEraseBlockHistoryPending',
    ERASE_BLOCK_HISTORY_GENERATION_SESSION_KEY: 'mbEraseBlockHistoryGeneration',
    LEGACY_CONTENT_INDEX_CLEANUP_MARKER_KEY: 'mbLegacyContentIndexCleanupV1',
    // Every stored key is this prefix plus its name above (storageNamespace.js). Builds of this layout share the prefix, so they read each
    // other's keys. A build with the unprefixed layout (1.6.1628 and earlier) never reads or writes these, and never overwrites them.
    STORAGE_LAYOUT_PREFIX: 'v1.6.'
}
