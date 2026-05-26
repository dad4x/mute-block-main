#!/usr/bin/env node

const {
    evaluate,
    getCdpConfig,
    getTargets,
    runMain
} = require('./lib/cdp')

runMain(async () => {
    const config = getCdpConfig()
    const targets = await getTargets(config)
    const serviceWorker = targets.find(target =>
        target.type === 'service_worker' && (target.url || '').includes(config.extensionId)
    )

    if(!serviceWorker) {
        console.log(JSON.stringify({serviceWorker: false}, null, 2))
        return
    }

    const state = await evaluate(serviceWorker.webSocketDebuggerUrl, `(() => ({
        serviceWorker: true,
        queuedTabActions: typeof queuedTabActions !== 'undefined' ? queuedTabActions.length : -1,
        queuedTabActionsSample: typeof queuedTabActions !== 'undefined'
            ? queuedTabActions.slice(0, 5).map(action => ({
                url: action.url || action.targetProfileHref || action.requestedUrl || '',
                coordinatorKey: action.coordinatorKey || '',
                runId: action.runId || '',
                attemptId: action.attemptId || action?.attempt?.id || '',
                attemptNumber: action.attemptNumber || action?.attempt?.number || 0
            }))
            : [],
        activeQueuedTabs: typeof activeQueuedTabs !== 'undefined' ? Array.from(activeQueuedTabs) : [],
        pendingTabActions: typeof pendingTabActions !== 'undefined' ? Array.from(pendingTabActions.keys()) : [],
        queuedTabMetadata: typeof queuedTabMetadata !== 'undefined' ? Array.from(queuedTabMetadata.keys()) : [],
        queuedTabFillPromise: !!(typeof queuedTabFillPromise !== 'undefined' && queuedTabFillPromise),
        coordinatorResumePromise: !!(typeof coordinatorResumePromise !== 'undefined' && coordinatorResumePromise),
        quoraRuntimeActivated: typeof quoraRuntimeActivated !== 'undefined' ? quoraRuntimeActivated : null,
        storedWorkRepairTimeout: !!(typeof storedWorkRepairTimeout !== 'undefined' && storedWorkRepairTimeout),
        storedWorkRepairDueAt: typeof storedWorkRepairDueAt !== 'undefined' ? storedWorkRepairDueAt : 0,
        coordinatorQueueResumeTimeout: !!(typeof coordinatorQueueResumeTimeout !== 'undefined' && coordinatorQueueResumeTimeout),
        coordinatorQueueResumeDueAt: typeof coordinatorQueueResumeDueAt !== 'undefined' ? coordinatorQueueResumeDueAt : 0,
        queueWakeupMetricsLoaded: typeof queueWakeupMetricsLoaded !== 'undefined' ? queueWakeupMetricsLoaded : null,
        queueWakeupMetricsDirty: typeof queueWakeupMetricsDirty !== 'undefined' ? queueWakeupMetricsDirty : null,
        pendingQueueWakeupMetricsReset: typeof pendingQueueWakeupMetricsReset !== 'undefined' && pendingQueueWakeupMetricsReset
            ? {...pendingQueueWakeupMetricsReset}
            : null,
        coordinatorProgressSyncActive: !!(typeof coordinatorProgressSyncActive !== 'undefined' && coordinatorProgressSyncActive),
        spaceFeedStorageUpdateDepth: typeof spaceFeedStorageUpdateDepth !== 'undefined' ? spaceFeedStorageUpdateDepth : -1
    }))()`, 5000)

    console.log(JSON.stringify(state, null, 2))
})
