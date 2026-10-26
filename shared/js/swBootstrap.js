const {namespaceChanges} = require('./storageNamespace')

// Bootstrap/wiring tail extracted from sw.js (decomposition Slice 1).
//
// This module is pure composition-root code: a single function that
// registers the service worker's top-level browser event listeners
// (onInstalled / onStartup / alarms.onAlarm / tabs.onRemoved /
// tabs.onUpdated / storage.onChanged / runtime.onMessage /
// webRequest.onCompleted) plus the two startup kick-off calls that used
// to sit at the very end of sw.js. Nothing in the rest of sw.js calls into
// this module -- it only calls out, via the explicit `deps` object below,
// to functions and state that still live in sw.js.
//
// Mutable module-level `let` state that sw.js reassigns over its lifetime
// (quoraRuntimeActivated, coordinatorTabId, profileNukeProgress,
// profileNukeProgressProjectionWriteDepth, queuedActionSurfaceAnchorTabId,
// queuedActionSurfaceWindowId) is threaded through as live get/set
// accessors rather than snapshotted values, so a listener registered once
// at startup still observes current state whenever it fires later.

const {QUEUE_BAR_GET_ACTION, getQueueBarSummary, summarizeQueueBarView, recordQueueBarSummary, subscribeQueueBarTab, pushQueueBarSummary} = require('./swQueueBarSummary')
const {PROFILE_NUKE_PROGRESS_CLEAR_ACTION, PROFILE_NUKE_PROGRESS_GET_ACTION} = require('./swProfileNukeProgressPush')

function registerServiceWorkerListeners(deps = {}) {
    const {
        browser
    } = deps
    // A tab event can change how queued rows classify (a tab opened, closed or updated), so it bumps the executor input generation.
    const bumpExecutorInput = typeof deps.bumpExecutorInputGeneration === 'function' ? deps.bumpExecutorInputGeneration : () => {}

    // Times a request a content script awaits before it acts (profile pages wait on these), so a slow
    // worker shows up in the flight recorder as a content-request event. Diagnostic only.
    function timeContentRequest(action, run) {
        const startedAt = Date.now()
        const record = accepted => recordFlightRecorderEvent({
            kind: 'content-request',
            source: 'swBootstrap',
            reason: action,
            elapsedMs: Math.max(0, Date.now() - startedAt),
            accepted,
            changed: false
        })
        return Promise.resolve().then(run).then(
            result => {
                record(true)
                return result
            },
            error => {
                record(false)
                throw error
            }
        )
    }
    // D4: the message actions that read coordinator state. Each waits for the resident authority before its handler runs.
    // Every other action dispatches at once: the five that read only settings, metrics, the flight recorder, or in-memory debug
    // status (get-debug-resume-limit-status, refresh-queue-wakeup-metrics-view, reset-queue-wakeup-metrics, get-flight-recorder,
    // record-page-event) and any action no handler matches, which gets no response as before. An
    // action added to the dispatch chain without an entry here runs ungated, so a read of an unloaded authority fails loudly.
    const RUNTIME_MESSAGE_ACTIONS_WITH_AUTHORITY = new Set([
        // The queue bar's summary is answered after startup, so a request made on a cold worker waits for the authority (18 Oct).
        QUEUE_BAR_GET_ACTION,
        // A tool's read of the progress waits for the authority too, so it never reads an unloaded copy (decision 32).
        PROFILE_NUKE_PROGRESS_GET_ACTION,
        PROFILE_NUKE_PROGRESS_CLEAR_ACTION,
        'cloudflare-challenge-detected',
        'create-tab',
        'enqueue-coordinator-items',
        'open-coordinator',
        'open-coordinator-history',
        'coordinator-page-ready',
        'pause-coordinator-nukes',
        'clear-coordinator-events',
        'clear-coordinator-outliers',
        'get-coordinator-outlier-events',
        'set-space-nuked-posts',
        'merge-space-pending-nuked-posts',
        'set-coordinator-retry-failed-enabled',
        'resume-paused-coordinator-nukes',
        'cancel-coordinator-current-work',
        'cancel-coordinator-current-work-item',
        'clear-coordinator-current-work',
        'reconcile-coordinator-storage',
        'refresh-coordinator-queue-view',
        'refresh-coordinator-runs-view',
        'refresh-coordinator-dashboard-views',
        'get-coordinator-queue-accounting',
        'get-coordinator-why-not-running',
        'clear-coordinator-terminal-stats',
        'get-content-page-coordinator-state',
        'resume-coordinator-queue',
        'retry-coordinator-failed',
        'claim-tab-action',
        'resolve-queued-profile-target',
        'resolve-queued-profile-target-failed',
        'promote-queued-tab',
        'activate-confirmation-in-page-world',
        'begin-profile-action',
        'request-action-lease',
        'record-initial-blocked-state',
        'heartbeat-action-lease',
        'release-action-lease',
        'release-job-tab',
        'cancel-queued-owner-nukes',
        'pause-owner-nukes',
        'close-tab',
        'record-job-milestone',
        'record-job-terminal',
        'record-direct-profile-progress',
        'record-manual-profile-action',
        'get-recent-history',
        'clear-profile-nuke-state',
        'settle-terminal-coordinator-items',
        'remove-pending-space-feed-urls',
        'remove-pending-space-feed-entries',
        'confirm-space-feed-profiles-blocked',
        'get-owned-nuke-status',
        'get-coordinator-queue-runtime-state',
        'cleanup-owned-nuke-status',
        'sweep-owned-blocked-profile-tabs',
        'sweep-service-worker-blocked-profile-tabs'
    ])

    // The choke point (D4). A listener that can touch coordinator state runs only once the resident authority is loaded. A
    // hydrated authority makes ensureCoordinatorAuthorityHydrated return null, so the run starts at once with no added await.
    // A load that fails never reaches the handler: a listener that responds rejects, so the sender gets an error rather than a
    // hang; a fire-and-forget listener drops it (the failed load is already recorded as a coordinator-authority-unavailable
    // diagnostic).
    function runAfterCoordinatorAuthorityReady(run, {respond = false} = {}) {
        const pending = ensureCoordinatorAuthorityHydrated()
        if(!pending) return run()
        const ready = pending.then(() => run())
        return respond ? ready : ready.catch(() => null)
    }

    const {
        defaults,
        COORDINATOR_RESUME_ALARM_NAME,
        COORDINATOR_RETRY_FAILED_ENABLED_KEY,
        PERSISTENT_FAILED_RETRY_ALARM_NAME,
        TARGET_QUEUED_TAB_CONCURRENCY_KEY,
        WORKER_WINDOW_FOREGROUND_MODE_KEY,
        NUKED_POST_RETENTION_DAYS_KEY,
        MAX_REMEMBERED_NUKED_POSTS_KEY
    } = deps.constants || {}
    const {
        coordinatorReconcileScheduler,
        ownedTabIdsReady,
        queueRuntime,
        getQuoraRuntimeActivated,
        getCoordinatorTabId,
        getQueuedActionSurfaceAnchorTabId,
        getQueuedActionSurfaceWindowId,
        getProfileNukeProgress
    } = deps.state || {}
    const {
        activateConfirmationElementInPageWorld,
        applyCoordinatorQueueMachineEvent,
        beginCoordinatorProfileAction,
        cancelCoordinatorCurrentWork,
        cancelCoordinatorCurrentWorkItem,
        cancelQueuedOwnerActions,
        claimPendingTabAction,
        clearCoordinatorCurrentWork,
        clearCoordinatorReconcileAlarms,
        clearCoordinatorTerminalStats,
        clearPersistentFailedRetry,
        clearSchedulerAlarms,
        closeIdleQueuedWorkerActionSurfaceWindows,
        closeQueuedWorkerActionSurfaceIfIdle,
        consumeCanceledOwnerUrls,
        createOwnedTab,
        dedupeCoordinatorTabs,
        describeRuntimeMessage,
        detachQueuedTabRuntimeState,
        enqueueCoordinatorItems,
        ensureQuoraRuntimeActivatedForScheduler,
        forgetCoordinatorTabId,
        forgetQuoraRuntimeActivation,
        forgetRemovedCoordinatorTabId,
        getAttemptIdFromValue,
        getAttemptNumberFromValue,
        getContentPageCoordinatorState,
        getCoordinatorQueueAccounting,
        getCoordinatorQueueRuntimeState,
        getCoordinatorWhyNotRunning,
        getErrorPageUrl,
        getFlightRecorder,
        getDebugResumeLimitStatus,
        getLiveOwnedTabIds,
        getOwnedNukeStatus,
        getQueuedTabMetadata,
        handleCoordinatorBrowserStartup,
        recordInitialBlockedStateFromRequest,
        requestProfileBlockedPageEventCheck,
        requestQueuedTabRemovalRefill,
        heartbeatCoordinatorActionLease,
        incrementQueueWakeupMetric,
        isBrowserTabId,
        isCoordinatorReconcileAlarmName,
        isNonProfileQuoraHttpLandingUrl,
        isProfileResolutionMode,
        isQueuedWorkerActionSurfaceTab,
        isQuoraRuntimeUrl,
        isSuppressedStaleCoordinatorReconcileAlarm,
        isSuppressedStaleCoordinatorResumeAlarm,
        isTerminalProfileNukeRecord,
        isTransientProfileNukeStatus,
        kickCoordinatorQueueResume,
        makeQuoraRuntimeNotActivatedResult,
        markQueuedTabClosing,
        markQuoraRuntimeActivated,
        markQuoraRuntimeActivatedFromRequest,
        metricStorageSet,
        normalizeQuoraProfileUrl,
        normalizeRuntimeMessageAction,
        normalizeTabId,
        notifyQueuedWorkerActionSurfaceSlotMaybeFreed,
        openCoordinatorPage,
        openCoordinatorHistoryPage,
        pauseCoordinatorNukes,
        clearCoordinatorEventsRequested,
        eraseBlockHistoryRequested,
        clearCoordinatorOutliersRequested,
        getCoordinatorOutlierEventsRequested,
        setSpaceNukedPostsRequested,
        setCoordinatorRetryFailedEnabledRequested,
        setExtensionSettingsRequested,
        setSpaceSortRequested,
        setSpaceRegistryRequested,
        setDevModeEnabledRequested,
        setHiddenRunIdsRequested,
        claimDebugRunAutosaveRequested,
        registerQueuedWorkerActionSurfaceRequested,
        promoteQueuedTab,
        reconcileCoordinatorStorageBestEffort,
        reconcileReleasedActiveCoordinatorTab,
        recordCoordinatorJobProgressViaQueueMachine,
        recordDirectProfileProgressFromRequest,
        recordManualProfileActionRequested,
        getRecentHistoryRequested,
        recordFlightRecorderEvent,
        recordJobProgressFromRequest,
        refreshCoordinatorQueueViewForDashboard,
        refreshCoordinatorRunsViewForDashboard,
        refreshCoordinatorDashboardViewsForDashboard,
        refreshQueueWakeupMetricsViewForDashboard,
        releaseCoordinatorActionLease,
        releaseQueuedTab,
        rememberBrowserSessionMarker,
        rememberCanceledOwnerUrls,
        rememberQueueLoadPressure,
        requestCoordinatorActionLease,
        resetQueueWakeupMetricsEpochAfterLoad,
        resetQueuedWorkerActionSurface,
        resolveQueuedProfileTarget,
        restoreCoordinatorPageForPersistentRetry,
        restoreOwnerTabFocus,
        resumePausedCoordinatorNukes,
        retryCoordinatorFailedItems,
        runPersistentFailedRetryTick,
        runScheduledCoordinatorQueueResume,
        handleDebugResumeLimitAlarm,
        runScheduledCoordinatorReconcileTick,
        scheduleCoordinatorQueueResume,
        scheduleCoordinatorReconcile,
        scheduleQueuedTabContentScriptEnsure,
        scheduleQueuedWorkContinuation,
        scheduleQueuedWorkerActionSurfaceCleanup,
        scheduleStoredWorkRearmAfterExtensionReload,
        sendTabMessage,
        setQueuedTabMetadata,
        setTargetQueuedTabConcurrency,
        setWorkerWindowForegroundMode,
        setRecentHistoryRetentionDays,
        setRecentHistoryMaxEntries,
        shouldAllowStoredWorkBeforeQuora,
        startUserInitiatedCoordinatorQueueResume,
        stopOwnerNukes,
        sweepOwnedBlockedProfileTabs,
        sweepServiceWorkerBlockedProfileTabs,
        terminalizeQueuedTabNonProfileLandingFromMetadata,
        terminalizeQueuedTabProfileRedirectMismatchFromMetadata,
        validateQueuedTabAttempt,
        ensureCoordinatorAuthorityHydrated,
        readProfileNukeProgressForTools,
        clearProfileNukeProgressForTools,
        retireUnusedVersion15StorageKeys,
        checkStorageBuild,
        noteStorageRemovals
    } = deps.handlers || {}

    function handleRuntimeInstalled(details) {
        void retireUnusedVersion15StorageKeys().catch(() => null)
        void checkStorageBuild({reason: details.reason, previousVersion: details.previousVersion}).catch(() => null)
        const resetReason = details.reason === 'install'
            ? 'extension-installed'
            : 'extension-updated'
        void rememberBrowserSessionMarker(resetReason)
        void forgetQuoraRuntimeActivation(resetReason)
        void clearSchedulerAlarms(resetReason)
        void resetQueueWakeupMetricsEpochAfterLoad(resetReason, {deferUntilQuora: true}).then(() => {
            if(details.reason === 'install') {
                return metricStorageSet(defaults, {
                    snapshotWriteReason: 'userMemoryNonAuthority'
                })
            }
    
            scheduleStoredWorkRearmAfterExtensionReload(resetReason)
            return null
        })
    }
    function handleRuntimeStartup() {
        void retireUnusedVersion15StorageKeys().catch(() => null)
        void checkStorageBuild({reason: 'startup'}).catch(() => null)
        return handleCoordinatorBrowserStartup()
    }
    browser.runtime.onInstalled.addListener(details => runAfterCoordinatorAuthorityReady(() => handleRuntimeInstalled(details)))
    browser.runtime.onStartup.addListener(() => runAfterCoordinatorAuthorityReady(() => handleRuntimeStartup()))
    if(browser.alarms?.onAlarm) {
        const handleAlarm = async alarm => {
            if(handleDebugResumeLimitAlarm(alarm?.name)) {
                return null
            }
            if(alarm?.name === COORDINATOR_RESUME_ALARM_NAME) {
                if(isSuppressedStaleCoordinatorResumeAlarm(alarm)) {
                    incrementQueueWakeupMetric('pump.alarmStale')
                    return null
                }
                const allowBeforeQuora = await shouldAllowStoredWorkBeforeQuora('resume-alarm-stored-work')
                if(!allowBeforeQuora &&
                    !await ensureQuoraRuntimeActivatedForScheduler('resume-alarm-existing-quora-session')) {
                    void browser.alarms?.clear?.(COORDINATOR_RESUME_ALARM_NAME).catch(() => false)
                    return null
                }
                incrementQueueWakeupMetric('pump.alarmFired')
                return runScheduledCoordinatorQueueResume('resume-alarm', {allowBeforeQuora}).catch(() => null)
            }
    
            if(isCoordinatorReconcileAlarmName(alarm?.name)) {
                if(isSuppressedStaleCoordinatorReconcileAlarm(alarm)) {
                    incrementQueueWakeupMetric('reconcile.alarmStale')
                    return null
                }
                const allowBeforeQuora = await shouldAllowStoredWorkBeforeQuora('reconcile-alarm-stored-work')
                if(!allowBeforeQuora &&
                    !await ensureQuoraRuntimeActivatedForScheduler('reconcile-alarm-existing-quora-session')) {
                    clearCoordinatorReconcileAlarms()
                    return null
                }
                incrementQueueWakeupMetric('reconcile.alarmFired')
                coordinatorReconcileScheduler.clearSchedule()
                return runScheduledCoordinatorReconcileTick('coordinator-reconcile-alarm').catch(() => null)
            }
    
            if(alarm?.name === PERSISTENT_FAILED_RETRY_ALARM_NAME) {
                if(!await ensureQuoraRuntimeActivatedForScheduler('retry-alarm-existing-quora-session')) {
                    void browser.alarms?.clear?.(PERSISTENT_FAILED_RETRY_ALARM_NAME).catch(() => false)
                    return null
                }
                void runPersistentFailedRetryTick()
            }
        }
        browser.alarms.onAlarm.addListener(alarm => runAfterCoordinatorAuthorityReady(() => handleAlarm(alarm)))
    }
    function handleTabRemoved(tabId) {
        recordFlightRecorderEvent({
            kind: 'tab-removed',
            source: 'tabs.onRemoved',
            tabId,
            accepted: true,
            changed: false
        })
        notifyQueuedWorkerActionSurfaceSlotMaybeFreed()

        if(normalizeTabId(tabId) === normalizeTabId(getQueuedActionSurfaceAnchorTabId())) {
            resetQueuedWorkerActionSurface('anchor-removed')
        }

        if(tabId === getCoordinatorTabId()) {
            void forgetCoordinatorTabId(tabId)
        }
        else {
            void forgetRemovedCoordinatorTabId(tabId)
        }
    
        const detached = detachQueuedTabRuntimeState(tabId, 'tab-removed')
        // Any tab removal may free the worker-window slot, so the fill runs again now (owner 18 Oct). Most removals are tabs the
        // worker closed itself, and their queued-tab metadata is already gone, so the refill is not gated on it. Coalesced, and
        // a no-op while paused.
        requestQueuedTabRemovalRefill()

        void ownedTabIdsReady.then(async () => {
            const metadata = detached.metadata
            const isOwnerTab = detached.wasOwnerTab
            const wasOwnedChild = detached.wasOwnedChild
            if(metadata?.profileHref) {
                const progressRecord = getProfileNukeProgress()?.[normalizeQuoraProfileUrl(metadata.profileHref)] || null
                const shouldInterruptClosedTransient =
                    progressRecord &&
                    !isTerminalProfileNukeRecord(progressRecord) &&
                    isTransientProfileNukeStatus(progressRecord.status) &&
                    !metadata?.closeRequestedAt &&
                    !metadata?.retryRequestedAt
                let recoveredClosedTransient = null
                if(shouldInterruptClosedTransient) {
                    recoveredClosedTransient = await reconcileReleasedActiveCoordinatorTab(
                        metadata,
                        tabId,
                        'queued-tab-closed-before-terminal',
                        {
                            skipFreshContentReadiness: true,
                            skipFreshOpenDeferralAfterLeaseRelease: true
                        }
                    ).catch(error => ({
                        changed: false,
                        reason: 'queued-tab-closed-before-terminal-requeue-failed',
                        error: error?.message || `${error || ''}`
                    }))
                    if(recoveredClosedTransient?.changed === true &&
                        recoveredClosedTransient.status === 'queued') {
                        incrementQueueWakeupMetric('pump.changed.requeuedClosedBeforeTerminal')
                        recordFlightRecorderEvent({
                            kind: 'closed-before-terminal-requeue',
                            source: 'tabs.onRemoved',
                            rowKey: metadata.coordinatorKey || metadata.profileHref || '',
                            targetUrl: metadata.profileHref || metadata.requestedUrl || '',
                            attemptId: getAttemptIdFromValue(metadata) || getAttemptIdFromValue(progressRecord),
                            attemptNumber: getAttemptNumberFromValue(metadata) || getAttemptNumberFromValue(progressRecord),
                            runId: metadata.runId || progressRecord?.runId || '',
                            tabId,
                            accepted: true,
                            changed: true,
                            statusAfter: 'queued',
                            reason: 'queued-tab-closed-before-terminal'
                        })
                        scheduleCoordinatorQueueResume(1000, 'queued-tab-closed-before-terminal-requeued', {
                            allowBeforeQuora: true
                        })
                        scheduleQueuedWorkContinuation('queued-tab-closed-before-terminal-requeued')
                    }
                    else if(recoveredClosedTransient?.status !== 'failed') {
                        incrementQueueWakeupMetric('pump.noop.deferredClosedBeforeTerminal')
                        recordFlightRecorderEvent({
                            kind: 'closed-before-terminal-requeue',
                            source: 'tabs.onRemoved',
                            rowKey: metadata.coordinatorKey || metadata.profileHref || '',
                            targetUrl: metadata.profileHref || metadata.requestedUrl || '',
                            attemptId: getAttemptIdFromValue(metadata) || getAttemptIdFromValue(progressRecord),
                            attemptNumber: getAttemptNumberFromValue(metadata) || getAttemptNumberFromValue(progressRecord),
                            runId: metadata.runId || progressRecord?.runId || '',
                            tabId,
                            accepted: false,
                            changed: false,
                            reason: recoveredClosedTransient?.reason || 'queued-tab-closed-before-terminal-deferred',
                            ...(recoveredClosedTransient?.error ? {error: recoveredClosedTransient.error} : {})
                        })
                        scheduleCoordinatorQueueResume(1000, 'queued-tab-closed-before-terminal-deferred', {
                            allowBeforeQuora: true
                        })
                        scheduleCoordinatorReconcile(1000, {
                            reason: 'queued-tab-closed-before-terminal-deferred',
                            edgeTriggered: true,
                            allowBeforeQuora: true
                        })
                        scheduleQueuedWorkContinuation('queued-tab-closed-before-terminal-deferred')
                    }
                }
    
                const patch = {
                    tabClosedAt: Date.now(),
                    closedByExtension: !!metadata.closeRequestedAt,
                    closeReason: metadata.closeReason || '',
                    event: 'Queued tab closed'
                }
                if(!shouldInterruptClosedTransient) {
                    void recordCoordinatorJobProgressViaQueueMachine(metadata.profileHref, patch, {senderTabId: tabId})
                }
            }
            else if(metadata?.coordinatorKey) {
                const closeReason = `${metadata.closeReason || ''}`.trim()
                const pausedClose = /pause-request/.test(closeReason)
                if(!pausedClose) {
                    void applyCoordinatorQueueMachineEvent({
                        type: 'KEY_ONLY_TERMINATE',
                        coordinatorKey: metadata.coordinatorKey,
                        terminalOptions: {
                            status: metadata.closeRequestedAt ? 'canceled' : 'failed',
                            outcome: metadata.closeRequestedAt ? 'paused' : 'timeout',
                            error: metadata.closeRequestedAt
                                ? 'Queued profile-resolution tab closed by extension before resolving a profile'
                                : 'Queued profile-resolution tab closed before resolving a profile',
                            reason: closeReason || 'profile-resolution-tab-closed',
                            expectedAttemptId: metadata.attemptId || '',
                            expectedAttemptNumber: metadata.attemptNumber || 0
                        }
                    }, {
                        reason: 'reconcile'
                    })
                }
            }
            void restoreOwnerTabFocus(metadata, tabId)
            if(isOwnerTab) {
                void stopOwnerNukes(tabId, {
                    closeOwnedTabs: true,
                    reason: 'owner-tab-closed'
                })
            }
            queueRuntime.resumeQueuedOwner(tabId)
            void releaseQueuedTab(tabId, {
                runtimeDetached: true,
                metadata,
                wasActive: detached.wasActive,
                foregroundLeaseReleased: detached.foregroundLeaseReleased
            }).catch(() => incrementQueueWakeupMetric('queuedTab.releaseFailed'))
            if(metadata?.profileHref || metadata?.coordinatorKey || isOwnerTab || wasOwnedChild) {
                scheduleCoordinatorQueueResume(1000, 'tab-removed', {
                    allowBeforeQuora: true
                })
            }
        })
    }
    browser.tabs.onRemoved.addListener(tabId => {
        bumpExecutorInput()
        return runAfterCoordinatorAuthorityReady(() => handleTabRemoved(tabId))
    })
    function handleTabUpdated(tabId, changeInfo, tab) {
        const observedUrl = `${changeInfo.url || tab?.url || ''}`.trim()
        if(isQuoraRuntimeUrl(observedUrl)) {
            markQuoraRuntimeActivated('quora-tab-updated')
        }
    
        const metadata = getQueuedTabMetadata(tabId)
        if(metadata && changeInfo.status === 'complete') {
            // Marks the browser-level page-load boundary of a handoff, split
            // from 'tab-open-request' (swexecutor.js, fired when the tab is
            // first created) and 'profile-action-finalized'
            // (swCoordinatorProgressReducer.js, fired once the row goes
            // terminal): tab-open-request -> this event is page-load time
            // (not ours), this event -> profile-action-finalized is our own
            // block-and-finalize processing time. Correlated by targetUrl
            // (profileHref) rather than a shared rowKey/runId, since this
            // listener only has the tab's own metadata to go on.
            recordFlightRecorderEvent({
                kind: 'tab-page-load-complete',
                source: 'tabs.onUpdated',
                tabId,
                targetUrl: metadata.profileHref || metadata.coordinatorKey || observedUrl,
                runId: metadata.runId || '',
                attemptId: metadata.attemptId || '',
                attemptNumber: metadata.attemptNumber || 0
            })
            scheduleQueuedTabContentScriptEnsure(tabId, 'tab-load-complete')
        }
    
        if(metadata?.profileHref) {
            const lastUrl = `${observedUrl || metadata.lastUrl || ''}`.trim()
            if(lastUrl) {
                const errorPageUrl = getErrorPageUrl(lastUrl)
                const resolvedProfileHref = normalizeQuoraProfileUrl(lastUrl) || ''
                const remappedFromRequested = !!(
                    metadata.profileHref &&
                    resolvedProfileHref &&
                    resolvedProfileHref !== metadata.profileHref
                )
                setQueuedTabMetadata(tabId, {lastUrl})
                void recordCoordinatorJobProgressViaQueueMachine(metadata.profileHref, {
                    lastUrl,
                    resolvedProfileHref,
                    remappedFromRequested,
                    errorPageUrl,
                    event: changeInfo.url ? `Tab navigated to ${lastUrl}` : ''
                })
    
                if(errorPageUrl && /^(?:chrome|edge|about|moz-extension|chrome-error):/i.test(errorPageUrl)) {
                    const closeRequestedAt = markQueuedTabClosing(tabId, 'browser-error-page')
                    void releaseQueuedTab(tabId).catch(() => incrementQueueWakeupMetric('queuedTab.releaseFailed'))
                    void recordCoordinatorJobProgressViaQueueMachine(metadata.profileHref, {
                        status: 'error-page',
                        finalError: 'Queued tab navigated to a browser error page',
                        errorPageUrl,
                        closeRequestedAt,
                        event: 'Queued tab closed after navigating to a browser error page'
                    })
                    if(isBrowserTabId(metadata.ownerTabId)) {
                        void sendTabMessage(metadata.ownerTabId, {
                            status: 'owner-nuke-url-failed',
                            url: metadata.profileHref,
                            reason: 'Queued tab navigated to a browser error page'
                        })
                    }
                    void browser.tabs.remove(tabId).catch(() => {})
                    return
                }
                if(changeInfo.status === 'complete' &&
                    !metadata.resolveProfileFromPage &&
                    !isProfileResolutionMode(metadata.resolutionMode || '') &&
                    metadata.profileHref &&
                    resolvedProfileHref &&
                    resolvedProfileHref !== metadata.profileHref) {
                    void terminalizeQueuedTabProfileRedirectMismatchFromMetadata(tabId, metadata, resolvedProfileHref)
                    return
                }
                if(changeInfo.status === 'complete' &&
                    !metadata.resolveProfileFromPage &&
                    !isProfileResolutionMode(metadata.resolutionMode || '') &&
                    isNonProfileQuoraHttpLandingUrl(lastUrl)) {
                    void terminalizeQueuedTabNonProfileLandingFromMetadata(tabId, metadata, lastUrl)
                    return
                }
            }
        }
    
        if(changeInfo.status !== 'loading' || tabId === getCoordinatorTabId()) return
    
        queueRuntime.pauseQueuedOwner(tabId)
        const canceledUrls = cancelQueuedOwnerActions(tabId, 'nuke')
        rememberCanceledOwnerUrls(tabId, canceledUrls)
    }
    browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        bumpExecutorInput()
        return runAfterCoordinatorAuthorityReady(() => handleTabUpdated(tabId, changeInfo, tab))
    })
    function handleStorageChanged(changes, areaName) {
        if(areaName !== 'local') return
    
        if(getQuoraRuntimeActivated() && changes?.[COORDINATOR_RETRY_FAILED_ENABLED_KEY]?.newValue) {
            void restoreCoordinatorPageForPersistentRetry()
        }
        else if(changes?.[COORDINATOR_RETRY_FAILED_ENABLED_KEY]) {
            clearPersistentFailedRetry()
        }
        if(changes?.[TARGET_QUEUED_TAB_CONCURRENCY_KEY]) {
            setTargetQueuedTabConcurrency(changes[TARGET_QUEUED_TAB_CONCURRENCY_KEY].newValue)
        }
        if(changes?.[WORKER_WINDOW_FOREGROUND_MODE_KEY]) {
            setWorkerWindowForegroundMode(changes[WORKER_WINDOW_FOREGROUND_MODE_KEY].newValue)
        }
        // The completed-work log uses the recent-history preferences: applied to the next checkpoint.
        if(changes?.[NUKED_POST_RETENTION_DAYS_KEY]) setRecentHistoryRetentionDays(changes[NUKED_POST_RETENTION_DAYS_KEY].newValue)
        if(changes?.[MAX_REMEMBERED_NUKED_POSTS_KEY]) setRecentHistoryMaxEntries(changes[MAX_REMEMBERED_NUKED_POSTS_KEY].newValue)
        // Progress lives in session storage (decision 31), and nothing writes its view to disk now, so no progress key is read here.
        // A change to the old disk key is not handled (20 Oct review, decision 2).
    }
    browser.storage.onChanged.addListener((changes, areaName) => {
        if(areaName !== 'local') return undefined
        // This layout's keys only, with their plain names (storageNamespace.js).
        const ownChanges = namespaceChanges(changes)
        if(!ownChanges) return undefined
        // Synchronous, before the readiness gate: a clear is seen at once, so a switch that starts after it cannot reuse a slot that is gone.
        noteStorageRemovals(ownChanges)
        return runAfterCoordinatorAuthorityReady(() => handleStorageChanged(ownChanges, areaName))
    })
    browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
        const action = normalizeRuntimeMessageAction(request)
        request = {...(request || {}), action}
        markQuoraRuntimeActivatedFromRequest(request, sender, `message:${describeRuntimeMessage(request)}`)
        if(!RUNTIME_MESSAGE_ACTIONS_WITH_AUTHORITY.has(request.action)) return dispatchRuntimeMessage(request, sender)
        return runAfterCoordinatorAuthorityReady(() => dispatchRuntimeMessage(request, sender), {respond: true})
    })

    function dispatchRuntimeMessage(request, sender) {
    
        if(request.action === 'create-tab') {
            return createOwnedTab({
                url: request.url,
                ownerTabId: sender.tab?.id || null,
                ownerWindowId: sender.tab?.windowId || null
            }).then(tab => {
                if(request.tabAction) {
                    queueRuntime.setPendingTabAction(tab.id, {
                        action: request.tabAction,
                        profileHref: normalizeQuoraProfileUrl(request.url || ''),
                        targetUrl: request.url || '',
                        requestedUrl: request.url || ''
                    })
                }
                return {tabId: tab.id}
            })
        }
        else if(request.action === 'enqueue-coordinator-items') {
            return enqueueCoordinatorItems(request, sender)
        }
        else if(request.action === 'open-coordinator') {
            // sender.tab is only populated for messages from a tab. The
            // preferences page sends its own window id as well (see
            // preferences.js). Prefer that when present; sender.tab?.windowId
            // covers any other caller that is a tab.
            return openCoordinatorPage({
                windowId: Number.parseInt(request.windowId, 10) || sender.tab?.windowId || null,
                active: request.active === true
            })
        }
        else if(request.action === 'open-coordinator-history') {
            return openCoordinatorHistoryPage({
                windowId: Number.parseInt(request.windowId, 10) || sender.tab?.windowId || null,
                active: request.active === true
            })
        }
        else if(request.action === 'coordinator-page-ready') {
            return Promise.resolve()
                .then(() => {
                    if(!getQuoraRuntimeActivated()) return {
                        displayOnly: true,
                        requiresQuoraVisit: true
                    }

                    return dedupeCoordinatorTabs(sender.tab?.id || null).then(coordinator => ({
                        ...(coordinator || {}),
                        displayOnly: true
                    }))
                })
        }
        else if(request.action === 'pause-coordinator-nukes') {
            return pauseCoordinatorNukes()
        }
        else if(request.action === 'clear-coordinator-events') {
            return clearCoordinatorEventsRequested()
        }
        else if(request.action === 'clear-coordinator-outliers') {
            return clearCoordinatorOutliersRequested()
        }
        else if(request.action === 'get-coordinator-outlier-events') {
            return getCoordinatorOutlierEventsRequested(request)
        }
        else if(request.action === 'erase-block-history') {
            return eraseBlockHistoryRequested(request)
        }
        else if(request.action === 'set-space-nuked-posts') {
            return setSpaceNukedPostsRequested(request.nukedPosts)
        }
        else if(request.action === 'merge-space-pending-nuked-posts') {
            return applyCoordinatorQueueMachineEvent({
                type: 'SPACE_PENDING_NUKED_POSTS_MERGE',
                spaceKey: request.spaceKey,
                spaceUrl: request.spaceUrl,
                posts: request.posts
            })
        }
        else if(request.action === 'set-coordinator-retry-failed-enabled') {
            return setCoordinatorRetryFailedEnabledRequested(request.enabled === true)
        }
        else if(request.action === 'set-extension-settings') {
            return setExtensionSettingsRequested(request.settings)
        }
        else if(request.action === 'set-space-sort') {
            return setSpaceSortRequested(request.sortBy)
        }
        else if(request.action === 'set-space-registry') {
            return setSpaceRegistryRequested(request.spaceRegistry)
        }
        else if(request.action === 'set-dev-mode-enabled') {
            return setDevModeEnabledRequested(request.enabled === true)
        }
        else if(request.action === 'set-hidden-run-ids') {
            return setHiddenRunIdsRequested(request.runIds)
        }
        else if(request.action === 'claim-debug-run-autosave') {
            return claimDebugRunAutosaveRequested(request.limitId)
        }
        else if(request.action === 'register-queued-worker-action-surface') {
            return registerQueuedWorkerActionSurfaceRequested(sender)
        }
        else if(request.action === 'resume-paused-coordinator-nukes') {
            return resumePausedCoordinatorNukes({debugLimit: request.debugLimit || null})
        }
        else if(request.action === 'cancel-coordinator-current-work') {
            return cancelCoordinatorCurrentWork()
        }
        else if(request.action === 'cancel-coordinator-current-work-item') {
            return cancelCoordinatorCurrentWorkItem(request)
        }
        else if(request.action === QUEUE_BAR_GET_ACTION) {
            // The queue bar's summary, as the worker holds it (decisions 9 and 11). Null until a queue view has been recorded. The asking
            // tab is subscribed, so it receives later pushes (decision 15).
            subscribeQueueBarTab(sender?.tab?.id)
            if(getQueueBarSummary()) return Promise.resolve({summary: getQueueBarSummary()})
            // A cold worker has recorded no summary yet. The first view after startup is built here, its summary recorded and pushed
            // (decision 2, 18 Oct). A failed build answers null, which hides the bar.
            return refreshCoordinatorQueueViewForDashboard('queue-bar-first-build').then(result => {
                if(result?.view) {
                    const {summary, changed} = recordQueueBarSummary(summarizeQueueBarView(result.view, Date.now()))
                    if(changed) void pushQueueBarSummary(browser, summary)
                }
                return {summary: getQueueBarSummary()}
            }).catch(() => ({summary: null}))
        }
        else if(request.action === PROFILE_NUKE_PROGRESS_GET_ACTION) {
            // Tools read the whole progress through the worker (decision 32): the stored copy, as the content page reads it (20 Oct review).
            return Promise.resolve(readProfileNukeProgressForTools()).then(profileNukeProgress => ({profileNukeProgress}))
        }
        else if(request.action === PROFILE_NUKE_PROGRESS_CLEAR_ACTION) {
            // The dev tools' clear (20 Oct review). Only an extension page may clear progress: a message from a tab is refused.
            if(sender?.tab) return Promise.resolve({cleared: 0, saved: false, reason: 'extension-pages-only'})
            return clearProfileNukeProgressForTools()
        }
        else if(request.action === 'clear-coordinator-current-work') {
            return clearCoordinatorCurrentWork().then(result => {
                // Owner decision 11 (18 Oct): a successful clear writes an explicit zero summary. A failed clear returns a reason and
                // leaves the summary as it was.
                if(!result?.reason) {
                    const {summary} = recordQueueBarSummary({total: 0, pending: 0, updatedAt: Date.now()})
                    void pushQueueBarSummary(browser, summary)
                }
                return result
            })
        }
        else if(request.action === 'reconcile-coordinator-storage') {
            if(request.userInitiated !== true) {
                return Promise.resolve({
                    recovered: false,
                    displayOnly: true,
                    reason: 'display-only-reconcile-disabled',
                    reconcileScheduled: false,
                    scheduledOnly: false
                })
            }
    
            const allowBeforeQuora = request.allowBeforeQuora === true ||
                request.userInitiated === true
            const reconcileRequestReason = 'user-reconcile-request'
            const scheduledReason = `${reconcileRequestReason}-scheduled`
            const runDirectReconcile = async () => {
                const reconcile = await reconcileCoordinatorStorageBestEffort({
                    reason: reconcileRequestReason
                })
                const result = await kickCoordinatorQueueResume(reconcileRequestReason, {
                    direct: true,
                    allowBeforeQuora,
                    awaitFill: true
                })
                return {
                    ...(result || {}),
                    reconcile,
                    reconcileScheduled: true,
                    direct: true
                }
            }
    
            if(!getQuoraRuntimeActivated()) {
                return ensureQuoraRuntimeActivatedForScheduler('reconcile-existing-quora-tab')
                    .then(observed => {
                        if(!observed && !allowBeforeQuora) {
                            return makeQuoraRuntimeNotActivatedResult('quora-runtime-not-activated')
                        }
    
                        scheduleCoordinatorReconcile(1000, {
                            reason: reconcileRequestReason,
                            edgeTriggered: true,
                            allowBeforeQuora
                        })
                        if(request.userInitiated === true) return runDirectReconcile()
                        void kickCoordinatorQueueResume(reconcileRequestReason).catch(() => null)
                        return {
                            recovered: false,
                            reason: scheduledReason,
                            fallbackScheduled: true,
                            reconcileScheduled: true,
                            scheduledOnly: true
                        }
                    })
            }
    
            scheduleCoordinatorReconcile(1000, {
                reason: reconcileRequestReason,
                edgeTriggered: true,
                allowBeforeQuora
            })
            if(request.userInitiated === true) return runDirectReconcile()
            void kickCoordinatorQueueResume(reconcileRequestReason).catch(() => null)
            return Promise.resolve({
                recovered: false,
                reason: scheduledReason,
                fallbackScheduled: true,
                reconcileScheduled: true,
                scheduledOnly: true
            })
        }
        else if(request.action === 'refresh-coordinator-queue-view') {
            return refreshCoordinatorQueueViewForDashboard(request.reason || 'dashboard-refresh')
        }
        else if(request.action === 'refresh-coordinator-runs-view') {
            return refreshCoordinatorRunsViewForDashboard(request.reason || 'dashboard-refresh')
        }
        else if(request.action === 'refresh-coordinator-dashboard-views') {
            return refreshCoordinatorDashboardViewsForDashboard(request.reason || 'dashboard-refresh')
        }
        else if(request.action === 'get-coordinator-queue-accounting') {
            return getCoordinatorQueueAccounting(request)
        }
        else if(request.action === 'get-coordinator-why-not-running') {
            return getCoordinatorWhyNotRunning(request)
        }
        else if(request.action === 'get-flight-recorder') {
            return getFlightRecorder(request)
        }
        else if(request.action === 'get-debug-resume-limit-status') {
            // Must be a promise: a plain return value gets no response from the listener, so the
            // dashboard countdown never received an answer.
            return Promise.resolve(getDebugResumeLimitStatus())
        }
        else if(request.action === 'refresh-queue-wakeup-metrics-view') {
            return refreshQueueWakeupMetricsViewForDashboard(request.reason || 'dashboard-refresh')
        }
        else if(request.action === 'reset-queue-wakeup-metrics') {
            return resetQueueWakeupMetricsEpochAfterLoad('manual')
        }
        else if(request.action === 'clear-coordinator-terminal-stats') {
            return clearCoordinatorTerminalStats()
        }
        else if(request.action === 'get-content-page-coordinator-state') {
            return timeContentRequest('get-content-page-coordinator-state', () => getContentPageCoordinatorState(request, sender))
        }
        else if(request.action === 'resume-coordinator-queue') {
            const userInitiated = request.userInitiated === true
            if(userInitiated) {
                return startUserInitiatedCoordinatorQueueResume('dashboard-resume', {
                    allowBeforeQuora: request.allowBeforeQuora === true || userInitiated,
                    actionBudget: request.actionBudget,
                    awaitFill: request.awaitFill !== false,
                    timeoutMs: request.timeoutMs
                })
            }
            return kickCoordinatorQueueResume('dashboard-resume', {
                allowBeforeQuora: request.allowBeforeQuora === true,
                backgroundFastPath: true,
                skipAuthorityReconcile: true
            })
        }
        else if(request.action === 'retry-coordinator-failed') {
            return retryCoordinatorFailedItems(request, sender)
        }
        else if(request.action === 'claim-tab-action') {
            return claimPendingTabAction(sender)
        }
        else if(request.action === 'content-claim-retry-hit') {
            // Measurement only (review-2 C-3): a claim retry loop in content.js reports once, when it reaches its pass threshold.
            // Nothing here reads coordinator state, so the action is not in RUNTIME_MESSAGE_ACTIONS_WITH_AUTHORITY.
            const loop = /^[a-z-]{1,40}$/.test(`${request.loop || ''}`) ? request.loop : 'unknown'
            incrementQueueWakeupMetric(`contentClaimRetry.${loop}`)
            recordFlightRecorderEvent({
                kind: 'content-claim-retry-hit',
                source: 'content-script',
                targetUrl: `${request.href || ''}`,
                tabId: sender.tab?.id || null,
                accepted: true,
                reason: loop,
                passes: Number.isFinite(request.passes) ? request.passes : 0
            })
        }
        else if(request.action === 'content-live-check') {
            // Measurement only (owner, 15 Oct): the live-check card counts these. Nothing here reads coordinator state, so the
            // action is not in RUNTIME_MESSAGE_ACTIONS_WITH_AUTHORITY.
            if(request.check === 'did-not-land') incrementQueueWakeupMetric('liveCheck.didNotLand')
        }
        else if(request.action === 'cloudflare-challenge-detected') {
            incrementQueueWakeupMetric('cloudflareChallenge.detected')
            recordFlightRecorderEvent({
                kind: 'cloudflare-challenge-detected',
                source: 'content-script',
                targetUrl: `${request.href || ''}`,
                tabId: sender.tab?.id || null,
                accepted: true,
                reason: 'cf-chl-tk-query-param'
            })
            // Quora fronts profile pages with Cloudflare once request volume
            // gets high enough to look automated -- the same load-pressure
            // throttle used for slow/unscriptable tabs (drop to 1 concurrent
            // tab, exponential backoff) is the right response here too, so a
            // run that starts tripping challenges backs off instead of
            // hammering straight into more of them.
            rememberQueueLoadPressure('cloudflare-challenge', {
                href: `${request.href || ''}`,
                tabId: sender.tab?.id || null
            })
            // 2026-09-29: stamped on the tab's own metadata so
            // reloadQueuedTabAfterUnresponsiveContentScript (sw.js) can skip
            // reloading it -- confirmed live that a challenged tab's nudge
            // never gets accepted (it's not a profile page), which used to
            // trigger a reload every retry cycle. A Cloudflare "Just a
            // moment" JS challenge needs uninterrupted time to solve itself;
            // reloading restarts that clock, so the previous behavior could
            // keep a tab stuck indefinitely, only ever resolving if the user
            // happened to intervene manually.
            if(sender.tab?.id) {
                setQueuedTabMetadata(sender.tab.id, {
                    cloudflareChallengeDetectedAt: Date.now()
                })
            }
            return Promise.resolve({recorded: true})
        }
        else if(request.action === 'resolve-queued-profile-target') {
            return resolveQueuedProfileTarget(request, sender)
        }
        else if(request.action === 'resolve-queued-profile-target-failed') {
            return applyCoordinatorQueueMachineEvent({
                type: 'PROFILE_RESOLUTION_UNRESOLVED',
                request,
                sender
            })
        }
        else if(request.action === 'promote-queued-tab') {
            return validateQueuedTabAttempt(sender, request, {message: 'Ignored stale foreground promotion request'})
                .then(valid => valid
                    ? promoteQueuedTab(sender.tab?.id || null, request.reason || '')
                    : {promoted: false, staleAttempt: true})
        }
        else if(request.action === 'activate-confirmation-in-page-world') {
            return activateConfirmationElementInPageWorld(request, sender)
        }
        else if(request.action === 'begin-profile-action') {
            return beginCoordinatorProfileAction(request, sender)
        }
        else if(request.action === 'request-action-lease') {
            return requestCoordinatorActionLease(request, sender)
        }
        else if(request.action === 'record-page-event') {
            // Events the profile page reports about itself (a click on a block control, or the page's blocked
            // state changing). clientAt is the page's own clock, so it is not the moment the message arrived.
            recordFlightRecorderEvent({
                kind: 'page-event',
                source: 'content',
                reason: `${request.event || ''}`.slice(0, 40),
                statusAfter: `${request.detail || ''}`.slice(0, 80),
                targetUrl: `${sender.tab?.url || ''}`.slice(0, 200),
                tabId: sender.tab?.id || null,
                at: Number.parseInt(request.clientAt, 10) || undefined,
                accepted: true,
                changed: false
            })
            // A profile page that turned blocked is checked now, not at the next reconcile tick (owner 17 Oct). Not awaited: the
            // page gets its answer at once, and the check reports through the flight recorder and the row's own terminal write.
            if(request.event === 'profile-blocked-state' && request.detail === 'blocked' && sender.tab?.id) {
                void requestProfileBlockedPageEventCheck(sender.tab.id, 'profile-blocked-page-event').catch(() => null)
            }
            return Promise.resolve({recorded: true})
        }
        else if(request.action === 'record-initial-blocked-state') {
            return recordInitialBlockedStateFromRequest(request, sender)
        }
        else if(request.action === 'heartbeat-action-lease') {
            return heartbeatCoordinatorActionLease(request, sender)
        }
        else if(request.action === 'release-action-lease') {
            return releaseCoordinatorActionLease(request, sender)
        }
        else if(request.action === 'release-job-tab') {
            const tabId = sender.tab?.id
            if(!tabId) return Promise.resolve({released: false})
    
            return validateQueuedTabAttempt(sender, request, {message: 'Ignored stale job tab release request'})
                .then(async valid => {
                    if(!valid) return {released: false, staleAttempt: true}
                    const release = await releaseQueuedTab(tabId, {
                        awaitFill: true,
                        normalJobRelease: true
                    })
                    return {
                        ...(release && typeof release === 'object' ? release : {}),
                        released: true
                    }
                })
        }
        else if(request.action === 'cancel-queued-owner-nukes') {
            return timeContentRequest('cancel-queued-owner-nukes', () => {
                const ownerTabId = sender.tab?.id || null
                const canceledUrls = consumeCanceledOwnerUrls(ownerTabId)
                    .concat(cancelQueuedOwnerActions(ownerTabId, 'nuke'))
                return {
                    canceledUrls
                }
            })
        }
        else if(request.action === 'pause-owner-nukes') {
            const ownerTabId = sender.tab?.id || null
            queueRuntime.pauseQueuedOwner(ownerTabId)
            const canceledUrls = cancelQueuedOwnerActions(ownerTabId, 'nuke')
            return Promise.resolve({
                canceledUrls
            })
        }
        else if(request.action === 'close-tab') {
            const tabId = sender.tab?.id
    
            if(tabId) {
                return validateQueuedTabAttempt(sender, request, {message: 'Ignored stale close-tab request'})
                    .then(async valid => {
                        const shouldCleanupWorkerSurface = isQueuedWorkerActionSurfaceTab(
                            sender.tab || null,
                            getQueuedTabMetadata(tabId)
                        ) ||
                            (getQueuedActionSurfaceWindowId() &&
                                Number.parseInt(sender.tab?.windowId, 10) === Number.parseInt(getQueuedActionSurfaceWindowId(), 10))
                        if(!valid && !shouldCleanupWorkerSurface) return {closed: false, staleAttempt: true}
                        markQueuedTabClosing(tabId, 'content-close-request')
                        await releaseQueuedTab(tabId, {awaitFill: true})
                        if(shouldCleanupWorkerSurface) {
                            scheduleQueuedWorkerActionSurfaceCleanup('idle-after-release')
                        }
                        return browser.tabs.remove(tabId)
                            .then(async () => {
                                if(shouldCleanupWorkerSurface) {
                                    await closeQueuedWorkerActionSurfaceIfIdle('idle-after-release', {
                                        windowId: sender.tab?.windowId || null
                                    }).catch(() => false)
                                }
                                else {
                                    await closeIdleQueuedWorkerActionSurfaceWindows('idle-after-release').catch(() => false)
                                }
                                return {closed: true}
                            })
                            .catch(() => ({closed: false}))
                    })
            }
    
            return Promise.resolve({closed: false})
        }
        else if(request.action === 'record-job-milestone') {
            return timeContentRequest('record-job-milestone', () => recordJobProgressFromRequest(request, sender, {
                expectTerminal: false
            }))
        }
        else if(request.action === 'record-job-terminal') {
            return recordJobProgressFromRequest(request, sender, {
                expectTerminal: true
            })
        }
        else if(request.action === 'record-direct-profile-progress') {
            return recordDirectProfileProgressFromRequest(request, sender)
        }
        else if(request.action === 'record-manual-profile-action') {
            return recordManualProfileActionRequested(request)
        }
        else if(request.action === 'get-recent-history') {
            return getRecentHistoryRequested(request)
        }
        else if(request.action === 'clear-profile-nuke-state') {
            return applyCoordinatorQueueMachineEvent({
                type: 'PROFILE_STATE_CLEAR',
                profileHref: request.profileHref || request.href || '',
                reason: request.reason || ''
            })
        }
        else if(request.action === 'settle-terminal-coordinator-items') {
            return applyCoordinatorQueueMachineEvent({
                type: 'TERMINAL_COORDINATOR_ITEMS_SETTLE',
                options: {
                    profileHrefs: request.profileHrefs || request.urls || []
                }
            })
        }
        else if(request.action === 'remove-pending-space-feed-urls') {
            return applyCoordinatorQueueMachineEvent({
                type: 'PENDING_SPACE_FEED_URLS_REMOVE',
                urls: request.urls || []
            }).then(result => ({
                changed: !!result?.changed,
                pendingPosts: result?.pendingPosts || null
            }))
        }
        else if(request.action === 'remove-pending-space-feed-entries') {
            return applyCoordinatorQueueMachineEvent({
                type: 'PENDING_SPACE_FEED_ENTRIES_REMOVE',
                postKeys: request.postKeys || []
            }).then(result => ({
                changed: !!result?.changed,
                pendingPosts: result?.pendingPosts || null
            }))
        }
        else if(request.action === 'confirm-space-feed-profiles-blocked') {
            return applyCoordinatorQueueMachineEvent({
                type: 'SPACE_FEED_PROFILES_CONFIRM',
                profileHrefs: request.profileHrefs || request.urls || []
            }).then(result => ({
                confirmed: !!result?.confirmed,
                pendingPosts: result?.pendingPosts || null,
                nukedPosts: result?.nukedPosts || null
            }))
        }
        else if(request.action === 'get-owned-nuke-status') {
            return ownedTabIdsReady.then(async () => {
                return getOwnedNukeStatus(sender.tab?.id || null, {
                    runId: request.runId || ''
                })
            })
        }
        else if(request.action === 'get-coordinator-queue-runtime-state') {
            return ownedTabIdsReady.then(() => getCoordinatorQueueRuntimeState(request))
        }
        else if(request.action === 'cleanup-owned-nuke-status') {
            return ownedTabIdsReady.then(async () => {
                scheduleCoordinatorReconcile(1000, {reason: 'owned-nuke-status-cleanup'})
                await getLiveOwnedTabIds(sender.tab?.id || null)
                return getOwnedNukeStatus(sender.tab?.id || null, {
                    runId: request.runId || '',
                    cleanup: true
                })
            })
        }
        else if(request.action === 'sweep-owned-blocked-profile-tabs') {
            return sweepOwnedBlockedProfileTabs(sender.tab?.id || null)
        }
        else if(request.action === 'sweep-service-worker-blocked-profile-tabs') {
            return sweepServiceWorkerBlockedProfileTabs()
        }
    }
    browser.webRequest.onCompleted.addListener(details => {
        if(details.url.match(/TribePeopleModalQuery/i)) {
            sendTabMessage(details.tabId, {status: 'space-people-modal-loaded'})
        }
        else if(details.url.match(/TribeContributorOrHigherListQuery/i)) {
            sendTabMessage(details.tabId, {status: 'space-contributors-loaded'})
        }
        else if(details.url.match(/UserProfileFollowersModalQuery/i)) {
            sendTabMessage(details.tabId, {status: 'profile-followers-modal-loaded'})
        }
        else if(details.url.match(/UserProfileFollowers_ProfileTopics_Query/i)) {
            sendTabMessage(details.tabId, {status: 'profile-followers-loaded'})
        }
        else if(details.url.match(/UserProfileFollowingPeople_ProfileTopics_Query/i)) {
            sendTabMessage(details.tabId, {status: 'profile-following-loaded'})
        }
        else if(details.url.match(/userBlockModalInnerUtils_userSetBlock_Mutation/i)) {
            sendTabMessage(details.tabId, {status: 'profile-block-updated'})
        }
        else if(details.url.match(/ContentLogMainQuery/i)) {
            sendTabMessage(details.tabId, {status: 'question-log-loaded'})
        }
        else if(details.url.match(/QuestionCollapsedAnswerLoaderQuery/i)) {
            sendTabMessage(details.tabId, {status: 'question-page-loaded'})
        }
    },
    {
        urls: [
            'https://*.quora.com/graphql/gql_para_POST?q=TribePeopleModalQuery',
            'https://*.quora.com/graphql/gql_para_POST?q=TribeContributorOrHigherListQuery',
    
            'https://www.quora.com/graphql/gql_para_POST?q=UserProfileFollowersModalQuery',
            'https://www.quora.com/graphql/gql_para_POST?q=UserProfileFollowers_ProfileTopics_Query',
            'https://www.quora.com/graphql/gql_POST?q=userBlockModalInnerUtils_userSetBlock_Mutation',
            'https://www.quora.com/graphql/gql_para_POST?q=UserProfileFollowingPeople_ProfileTopics_Query',
    
            'https://www.quora.com/graphql/gql_para_POST?q=ContentLogMainQuery',
            'https://www.quora.com/graphql/gql_para_POST?q=QuestionCollapsedAnswerLoaderQuery'
        ]
    })
}

module.exports = {
    registerServiceWorkerListeners
}
