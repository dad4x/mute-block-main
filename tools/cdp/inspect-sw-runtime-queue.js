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
        process.exitCode = 1
        return
    }

    const result = await evaluate(serviceWorker.webSocketDebuggerUrl, `(${function inspectRuntimeQueue() {
        function countStatuses(queue) {
            const counts = {}
            for(const item of Object.values(queue || {})) {
                const status = `${item?.status || ''}`.trim() || '(blank)'
                counts[status] = (counts[status] || 0) + 1
            }
            return counts
        }

        const authorityState = typeof coordinatorAuthority !== 'undefined' && coordinatorAuthority?.isHydrated?.()
            ? coordinatorAuthority.current()
            : null
        const authorityQueue = authorityState?.queue || {}
        return {
            serviceWorker: true,
            authorityHydrated: !!authorityState,
            authorityCounts: countStatuses(authorityQueue),
            authorityRows: Object.keys(authorityQueue).length,
            queuedTabActions: typeof queuedTabActions !== 'undefined' ? queuedTabActions.length : null,
            activeQueuedTabs: typeof activeQueuedTabs !== 'undefined' ? Array.from(activeQueuedTabs) : null,
            pendingTabActions: typeof pendingTabActions !== 'undefined' ? pendingTabActions.size : null,
            coordinatorQueueResumeDueAt: typeof coordinatorQueueResumeDueAt !== 'undefined' ? coordinatorQueueResumeDueAt : null,
            coordinatorQueueResumeReason: typeof coordinatorQueueResumeReason !== 'undefined' ? coordinatorQueueResumeReason : null,
            coordinatorQueueResumeAllowBeforeQuora: typeof coordinatorQueueResumeAllowBeforeQuora !== 'undefined'
                ? coordinatorQueueResumeAllowBeforeQuora
                : null,
            hasCoordinatorQueueResumeTimeout: typeof coordinatorQueueResumeTimeout !== 'undefined'
                ? !!coordinatorQueueResumeTimeout
                : null,
            quoraRuntimeActivated: typeof quoraRuntimeActivated !== 'undefined' ? quoraRuntimeActivated : null,
            pausedQueuedOwners: typeof pausedQueuedOwners !== 'undefined' ? Array.from(pausedQueuedOwners) : null,
            queueWakeupCounters: typeof queueWakeupCounters !== 'undefined' ? queueWakeupCounters : null
        }
    }})()`, 20000)

    console.log(JSON.stringify(result, null, 2))
})
