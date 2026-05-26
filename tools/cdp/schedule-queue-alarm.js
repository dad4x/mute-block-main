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
    const alarm = getOption('alarm', 'resume')
    const delayMs = Math.max(0, Number.parseInt(getOption('delay-ms', '500'), 10) || 0)
    const name = alarm === 'repair'
        ? 'mb-stored-work-repair'
        : 'mb-coordinator-resume'
    const targets = await getTargets(config)
    const serviceWorker = targets.find(target =>
        target.type === 'service_worker' && (target.url || '').includes(config.extensionId)
    )
    const dashboardUrl = `chrome-extension://${config.extensionId}/coordinator.html`
    const extensionPage = targets.find(target => target.type === 'page' && target.url === dashboardUrl) ||
        targets.find(target => target.type === 'page' && (target.url || '').startsWith(`chrome-extension://${config.extensionId}/`))
    const target = serviceWorker || extensionPage

    if(!target) {
        console.log(JSON.stringify({scheduled: false, serviceWorker: false, extensionPage: false}, null, 2))
        process.exitCode = 1
        return
    }

    const result = await evaluate(target.webSocketDebuggerUrl, `(${async function scheduleQueueAlarm(name, delayMs) {
        try {
            await chrome.alarms.create(name, {when: Date.now() + delayMs})
            return {
                scheduled: true,
                name,
                delayMs
            }
        }
        catch(error) {
            return {
                scheduled: false,
                name,
                delayMs,
                error: error?.message || String(error || '')
            }
        }
    }})(${JSON.stringify(name)}, ${JSON.stringify(delayMs)})`, 10000)

    console.log(JSON.stringify({
        target: {
            id: target.id,
            type: target.type || '',
            title: target.title || '',
            url: target.url || ''
        },
        ...result
    }, null, 2))
})
