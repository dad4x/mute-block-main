#!/usr/bin/env node

const {
    evaluate,
    getCdpConfig,
    getOption,
    getTargets,
    readProfileNukeProgressFromWorker,
    runMain
} = require('./lib/cdp')

const QUEUE_KEY = 'mbCoordinatorQueue'

function normalizeHref(value = '') {
    try {
        const url = new URL(`${value || ''}`)
        url.hash = ''
        url.search = ''
        return url.href.replace(/\/$/, '')
    }
    catch {
        return `${value || ''}`.replace(/[?#].*$/, '').replace(/\/$/, '')
    }
}

runMain(async () => {
    const config = getCdpConfig()
    const needle = getOption('needle', process.env.MB_QUEUE_NEEDLE || '').toLowerCase()
    const key = getOption('key', '')
    const context = getOption('context', 'auto')
    const targets = await getTargets(config)
    const dashboardUrl = `chrome-extension://${config.extensionId}/coordinator.html`
    const extensionPage = targets.find(target => target.type === 'page' && target.url === dashboardUrl) ||
        targets.find(target => target.type === 'page' && (target.url || '').startsWith(`chrome-extension://${config.extensionId}/`))
    const serviceWorker = targets.find(target => target.type === 'service_worker' && (target.url || '').includes(config.extensionId))
    const target = context === 'sw'
        ? serviceWorker
        : context === 'page'
            ? extensionPage
            : extensionPage || serviceWorker

    if(!target) {
        console.log(JSON.stringify({extensionContext: false}, null, 2))
        process.exitCode = 1
        return
    }

    const progressRecords = await readProfileNukeProgressFromWorker(config)
    const result = await evaluate(target.webSocketDebuggerUrl, `(${function inspectBrief(queueKey, progress, key, needle) {
        const normalize = value => {
            try {
                const url = new URL(`${value || ''}`)
                url.hash = ''
                url.search = ''
                return url.href.replace(/\/$/, '')
            }
            catch {
                return `${value || ''}`.replace(/[?#].*$/, '').replace(/\/$/, '')
            }
        }
        const withTimeout = promise => new Promise(resolve => {
            const timeout = setTimeout(() => resolve({timedOut: true}), 20000)
            Promise.resolve(promise)
                .then(value => {
                    clearTimeout(timeout)
                    resolve({timedOut: false, value})
                })
                .catch(error => {
                    clearTimeout(timeout)
                    resolve({timedOut: false, error: error?.message || String(error || '')})
                })
        })
        const readStorage = () => new Promise(resolve => {
            chrome.storage.local.get({[queueKey]: {}}, value => resolve(value || {}))
        })
        return withTimeout(readStorage()).then(result => {
            if(result.timedOut || result.error) return result
            const queue = result.value?.[queueKey] || {}
            const entries = Object.entries(queue)
            const match = key
                ? entries.find(([itemKey]) => itemKey === key)
                : entries.find(([itemKey, item]) => [
                    itemKey,
                    item?.targetProfileHref || '',
                    item?.requestedUrl || '',
                    item?.source?.pageUrl || '',
                    item?.runId || ''
                ].join('\\n').toLowerCase().includes(needle))
            if(!match) {
                return {
                    timedOut: false,
                    matched: false,
                    queueSize: entries.length
                }
            }
            const [itemKey, item] = match
            const targetHref = normalize(item?.targetProfileHref || item?.requestedUrl || itemKey)
            const progressEntries = Object.entries(progress)
                .filter(([progressKey, record]) => {
                    const recordHref = normalize(record?.profileHref || record?.profileUrl || progressKey)
                    return progressKey === itemKey || recordHref === targetHref
                })
                .map(([progressKey, record]) => ({progressKey, record}))
            return {
                timedOut: false,
                matched: true,
                now: Date.now(),
                queueSize: entries.length,
                itemKey,
                item,
                progress: progressEntries
            }
        })
    }})( ${JSON.stringify(QUEUE_KEY)}, ${JSON.stringify(progressRecords)}, ${JSON.stringify(key)}, ${JSON.stringify(needle)} )`, 45000)

    const output = {
        target: {
            id: target.id,
            type: target.type,
            title: target.title || '',
            url: target.url || ''
        },
        context,
        needle,
        key,
        ...result
    }
    if(output.item?.targetProfileHref || output.item?.requestedUrl || output.itemKey) {
        output.normalizedTarget = normalizeHref(output.item.targetProfileHref || output.item.requestedUrl || output.itemKey)
    }
    console.log(JSON.stringify(output, null, 2))
})
