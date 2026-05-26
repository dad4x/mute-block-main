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
    const needle = getOption('needle', process.env.MB_QUEUE_NEEDLE || '').toLowerCase()
    const maxConcurrent = Math.max(1, Number.parseInt(getOption('max-concurrent', '1'), 10) || 1)
    const limit = Math.max(0, Number.parseInt(getOption('limit', process.env.MB_QUEUE_LIMIT || '0'), 10) || 0)
    const messageTimeoutMs = Math.max(1000, Number.parseInt(getOption('message-timeout-ms', '60000'), 10) || 60000)
    const targets = await getTargets(config)
    const dashboardUrl = `chrome-extension://${config.extensionId}/coordinator.html`
    const extensionPage = targets.find(target => target.type === 'page' && target.url === dashboardUrl) ||
        targets.find(target => target.type === 'page' && (target.url || '').startsWith(`chrome-extension://${config.extensionId}/`))

    if(!extensionPage) {
        console.log(JSON.stringify({extensionPage: false}, null, 2))
        process.exitCode = 1
        return
    }

    const result = await evaluate(extensionPage.webSocketDebuggerUrl, `(${async function requeueFailures(needle, maxConcurrent, limit, messageTimeoutMs) {
        const storage = await chrome.storage.local.get({mbCoordinatorQueue: {}})
        const queue = storage.mbCoordinatorQueue || {}
        const selectedItems = Object.entries(queue)
            .filter(([, item]) => {
                if(!item || item.status !== 'failed') return false
                if(!needle) return true
                return [
                    item.sourceType || '',
                    item?.source?.type || '',
                    item?.source?.pageUrl || '',
                    item.runId || '',
                    item.targetProfileHref || '',
                    item.requestedUrl || '',
                    item.error || '',
                    item.finalError || ''
                ].join('\\n').toLowerCase().includes(needle)
            })
            .slice(0, limit > 0 ? limit : undefined)
            .map(([key, item]) => ({
                key,
                profileHref: item.targetProfileHref || '',
                coordinatorKey: item.coordinatorKey || item.dedupeKey || key || ''
            }))
        const profileHrefs = selectedItems.map(item => item.profileHref).filter(Boolean)
        const coordinatorKeys = selectedItems.map(item => item.coordinatorKey || item.key).filter(Boolean)
        const storageKeys = selectedItems.map(item => item.key).filter(Boolean)

        if(!selectedItems.length) return {selected: 0, queued: 0, reason: 'no-failures'}

        return new Promise(resolve => {
            let settled = false
            const finish = value => {
                if(settled) return
                settled = true
                resolve(value)
            }
            setTimeout(() => finish({
                response: null,
                timedOut: true,
                lastError: '',
                requested: selectedItems.length,
                profileHrefs: profileHrefs.length,
                coordinatorKeys: coordinatorKeys.length
            }), messageTimeoutMs)
            chrome.runtime.sendMessage({
                action: 'requeue-coordinator-failed',
                profileHrefs,
                coordinatorKeys,
                storageKeys,
                maxConcurrent
            }, response => finish({
                response: response || null,
                lastError: chrome.runtime.lastError ? chrome.runtime.lastError.message : '',
                requested: selectedItems.length,
                profileHrefs: profileHrefs.length,
                coordinatorKeys: coordinatorKeys.length
            }))
        })
    }})( ${JSON.stringify(needle)}, ${JSON.stringify(maxConcurrent)}, ${JSON.stringify(limit)}, ${JSON.stringify(messageTimeoutMs)} )`, messageTimeoutMs + 5000)

    console.log(JSON.stringify(result, null, 2))
})
