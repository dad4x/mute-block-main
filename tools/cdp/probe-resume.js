#!/usr/bin/env node

const {
    evaluate,
    getCdpConfig,
    getOption,
    getTargets,
    runMain
} = require('./lib/cdp')

runMain(async () => {
    const config = getCdpConfig()
    const skipStorage = getOption('skip-storage', 'false') === 'true'
    const targets = await getTargets(config)
    const serviceWorker = targets.find(target =>
        target.type === 'service_worker' && (target.url || '').includes(config.extensionId)
    )

    if(!serviceWorker) {
        console.log(JSON.stringify({serviceWorker: false}, null, 2))
        process.exitCode = 1
        return
    }

    const result = await evaluate(serviceWorker.webSocketDebuggerUrl, `(${async function probeResume(skipStorage) {
        const out = {
            serviceWorker: true,
            types: {
                recoverStoredCoordinatorWork: typeof recoverStoredCoordinatorWork,
                resumeCoordinatorQueueExecution: typeof resumeCoordinatorQueueExecution,
                resumeCoordinatorQueueExecutionOnce: typeof resumeCoordinatorQueueExecutionOnce,
                enqueueExistingExecutorForCoordinator: typeof enqueueExistingExecutorForCoordinator,
                fillQueuedTabs: typeof fillQueuedTabs,
                sweepStaleQueuedTabs: typeof sweepStaleQueuedTabs
            },
            state: {
                queuedTabActions: typeof queuedTabActions !== 'undefined' ? queuedTabActions.length : null,
                activeQueuedTabs: typeof activeQueuedTabs !== 'undefined' ? Array.from(activeQueuedTabs) : null,
                queuedTabFillPromise: typeof queuedTabFillPromise !== 'undefined' ? !!queuedTabFillPromise : null,
                coordinatorResumePromise: typeof coordinatorResumePromise !== 'undefined' ? !!coordinatorResumePromise : null,
                coordinatorExecutorStartPromise: typeof coordinatorExecutorStartPromise !== 'undefined' ? !!coordinatorExecutorStartPromise : null,
                spaceFeedStorageUpdateDepth: typeof spaceFeedStorageUpdateDepth !== 'undefined' ? spaceFeedStorageUpdateDepth : null
            }
        }

        if(skipStorage) return out

        const storage = await chrome.storage.local.get({
            mbCoordinatorQueue: {},
            mbCoordinatorPaused: false
        })
        const queue = storage.mbCoordinatorQueue || {}
        out.paused = !!storage.mbCoordinatorPaused
        out.pending = Object.entries(queue)
            .filter(([, item]) => item && (item.status === 'queued' || ['opening', 'active', 'acting', 'settling'].includes(item.status)))
            .map(([key, item]) => ({
                key,
                status: item.status || '',
                targetProfileHref: item.targetProfileHref || '',
                requestedUrl: item.requestedUrl || '',
                runId: item.runId || '',
                tabId: item.tabId || item.activeTabId || 0,
                executorOwner: item.executorOwner || '',
                serviceWorkerOwned: item.serviceWorkerOwned === true,
                attemptId: item.attemptId || item?.attempt?.id || '',
                attemptNumber: item.attemptNumber || item?.attempt?.number || 0,
                executorMaxConcurrent: item.executorMaxConcurrent || 0
            }))

        return out
    }})(${JSON.stringify(skipStorage)})`, 10000)

    console.log(JSON.stringify(result, null, 2))
})
