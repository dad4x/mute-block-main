| Module :: function | First line | Storage / WAL calls |
|---|---|---|
| sw.js :: absorbPersistedSnapshot | 9301 | WAL segment hydrate, WAL queue recovery |
| sw.js :: clearProfileNukeState | 24618 | queue projection load |
| sw.js :: confirmSpaceFeedProfilesBlocked | 24939 | metricStorageGet |
| sw.js :: coordinatorRunsUpdateLockedUpdate | 10470 | metricStorageGet |
| sw.js :: deleteProfileNukeProgressRowProjection | 6027 | metricStorageGet |
| sw.js :: enqueueCoordinatorItemsStorageLocked | 23976 | queue projection load |
| sw.js :: fillQueuedTabsOnce | 34431 | metricStorageGet |
| sw.js :: findCompletedWorkRowByKey | 9975 | metricStorageGet, queue projection load, WAL replay |
| sw.js :: finishCoordinatorEnqueue | 24437 | metricStorageGet |
| sw.js :: flushPendingCoordinatorDiagnosticEvents | 5628 | metricStorageGet |
| sw.js :: forgetRemovedCoordinatorTabId | 11657 | metricStorageGet |
| sw.js :: getContentPageCoordinatorState | 35103 | metricStorageGet |
| sw.js :: getCoordinatorQueueAccounting | 5705 | metricStorageGet, queue projection load, WAL queue recovery |
| sw.js :: getCoordinatorWhyNotRunning | 20659 | metricStorageGet |
| sw.js :: getRecentCompletedWorkRows | 9989 | metricStorageGet, queue projection load, WAL replay |
| sw.js :: getStoredCoordinatorTabId | 11669 | metricStorageGet |
| sw.js :: hasScheduledCoordinatorRuntimeOrDurableWork | 21883 | metricStorageGet |
| sw.js :: hasUnpausedStoredCoordinatorWorkInDurableQueue | 21601 | metricStorageGet, queue projection load, WAL queue recovery |
| sw.js :: isCoordinatorAutoStartOnBrowserStartEnabled | 2140 | metricStorageGet |
| sw.js :: isCoordinatorPauseGenerationCurrent | 20959 | metricStorageGet |
| sw.js :: loadCoordinatorCurrentAuthorityState | 10113 | current authority load, metricStorageGet, queue projection load |
| sw.js :: loadCoordinatorDashboardAuthoritySnapshot | 6244 | dashboard snapshot, metricStorageGet, queue projection load, WAL replay |
| sw.js :: loadCoordinatorQueueProjection | 9926 | queue projection load, metricStorageGet |
| sw.js :: loadCoordinatorQueueRowsFromStorage | 15217 | mirror read, metricStorageGet, keyed row project |
| sw.js :: loadCoordinatorQueueRunsEventsProgressProjection | 10248 | queue projection load, metricStorageGet |
| sw.js :: loadCoordinatorQueueRunsEventsProjection | 10221 | queue projection load, metricStorageGet |
| sw.js :: loadCoordinatorQueueRunsPendingProjection | 10315 | queue projection load, metricStorageGet |
| sw.js :: loadCoordinatorQueueRunsProgressPendingNukedProjection | 10341 | queue projection load, metricStorageGet |
| sw.js :: loadCoordinatorQueueRunsProgressProjection | 10000 | queue projection load, metricStorageGet |
| sw.js :: loadCoordinatorQueueRunsProjection | 9948 | queue projection load, metricStorageGet |
| sw.js :: loadCoordinatorQueueRunsScopedProgressProjection | 10028 | queue projection load, metricStorageGet |
| sw.js :: loadCoordinatorQueueRunsScopedProgressProjectionForMutation | 10097 | queue projection load |
| sw.js :: loadCoordinatorQueueWalProjection | 7128 | queue projection load |
| sw.js :: loadCoordinatorQueueWalStoreFromStorage | 6966 | metricStorageGet, WAL segment hydrate |
| sw.js :: loadCoordinatorReconcileProjection | 10282 | metricStorageGet, queue projection load |
| sw.js :: loadCoordinatorStatsClearedAtFromStorage | 6205 | metricStorageGet |
| sw.js :: loadOwnedTabIdsByParent | 29094 | metricStorageGet |
| sw.js :: loadProfileNukeProgress | 24514 | metricStorageGet |
| sw.js :: loadProjectedProfileNukeProgressRow | 24570 | metricStorageGet |
| sw.js :: loadQueueWakeupMetrics | 5572 | storageAdapter.get |
| sw.js :: loadScopedProgressProjection | 10063 | metricStorageGet |
| sw.js :: loadTargetQueuedTabConcurrencyPreference | 2155 | metricStorageGet |
| sw.js :: markQueuedProfileResolutionUnresolved | 32412 | metricStorageGet |
| sw.js :: metricStorageGet | 2407 | metricStorageGet, storageAdapter.get |
| sw.js :: mirrorCoordinatorQueueWalAfterAck | 6770 | mirror rebuild |
| sw.js :: mutateCoordinatorFailedItemsRequeue | 23437 | queue projection load |
| sw.js :: mutateCoordinatorFailedItemsRetry | 23097 | queue projection load |
| sw.js :: mutateCoordinatorKeyOnlyItemTerminalize | 26188 | queue projection load |
| sw.js :: mutateCoordinatorPauseStateSet | 21446 | metricStorageGet |
| sw.js :: mutateCoordinatorQueuedProfileTargetResolve | 32091 | queue projection load |
| sw.js :: mutateCoordinatorStoredWorkCancel | 25468 | queue projection load |
| sw.js :: mutateCoordinatorStoredWorkClear | 25654 | queue projection load |
| sw.js :: mutateCoordinatorStoredWorkItemCancel | 25336 | queue projection load |
| sw.js :: mutateCoordinatorStoredWorkPause | 25096 | queue projection load |
| sw.js :: nextCoordinatorPauseGenerationFromStorage | 20946 | metricStorageGet |
| sw.js :: performCoordinatorQueueWalCheckpointSwitch | 8139 | metricStorageGet, queue projection load, WAL replay |
| sw.js :: readCoordinatorQueueItemByKey | 15323 | queue projection load, current authority load |
| sw.js :: readCoordinatorQueueRowsFromMirror | 6786 | mirror read, metricStorageGet, keyed row project |
| sw.js :: readCoordinatorQueueRowsFromResident | 15182 | metricStorageGet |
| sw.js :: rebuildContentPageStateProjectionFromCurrentState | 35058 | metricStorageGet |
| sw.js :: rebuildCoordinatorQueueMirrorFromDisk | 6709 | mirror rebuild, metricStorageGet |
| sw.js :: recoverCoordinatorQueueFromWal | 7404 | WAL queue recovery, WAL replay |
| sw.js :: recoverQueueFromWalStore | 9920 | WAL queue recovery |
| sw.js :: refreshCoordinatorDashboardViewsForDashboard | 6396 | dashboard snapshot |
| sw.js :: refreshCoordinatorQueueViewForDashboard | 6337 | dashboard snapshot |
| sw.js :: refreshCoordinatorRunsViewForDashboard | 6379 | dashboard snapshot |
| sw.js :: removePendingSpaceFeedEntries | 24898 | metricStorageGet |
| sw.js :: removePendingSpaceFeedUrls | 24848 | metricStorageGet |
| sw.js :: restoreCoordinatorPageForPersistentRetry | 11783 | metricStorageGet |
| sw.js :: restoreLatestCoordinatorPauseGenerationIfStale | 20973 | metricStorageGet |
| sw.js :: restoreRuntimeProfileNukeProgressRow | 24541 | metricStorageGet |
| sw.js :: restoreStoredCoordinatorPausedMirror | 21632 | metricStorageGet |
| sw.js :: resumeCoordinatorQueueExecutionOnce | 20794 | metricStorageGet |
| sw.js :: runCoordinatorExecutorApplyPhase | 17678 | metricStorageGet |
| sw.js :: runCoordinatorQueueExecutorFastPath | 22070 | metricStorageGet |
| sw.js :: runCoordinatorReconcileTickOnce | 22649 | metricStorageGet |
| sw.js :: runPersistentFailedRetryTick | 11875 | metricStorageGet |
| sw.js :: runScheduledCoordinatorQueueResume | 22233 | metricStorageGet |
| sw.js :: saveProfileNukeProgressRowProjection | 5905 | metricStorageGet |
| sw.js :: settleTerminalCoordinatorItemsLocked | 11287 | metricStorageGet, queue projection load, WAL queue recovery |
| sw.js :: snapshotDiagnosticsOnPause | 21067 | metricStorageGet |
| sw.js :: verifyCoordinatorAuthorityStateForRowsCheap | 10184 | metricStorageGet |
