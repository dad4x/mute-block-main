#!/usr/bin/env node

const {
    cdpCommand,
    getCdpConfig,
    getJson,
    getOption,
    getTargets,
    runMain,
    sleep
} = require('./lib/cdp')

runMain(async () => {
    const config = getCdpConfig()
    const targetId = getOption('target-id', '')
    const urlNeedle = getOption('url-contains', '')
    const targets = await getTargets(config)
    const target = targetId
        ? targets.find(candidate => candidate.id === targetId)
        : targets.find(candidate => candidate.type === 'page' && (!urlNeedle || (candidate.url || '').includes(urlNeedle)))

    if(!target) {
        console.log(JSON.stringify({ok: false, reason: 'target-not-found', targetId, urlNeedle}, null, 2))
        process.exitCode = 1
        return
    }

    const versionInfo = await getJson('/json/version', config)
    await cdpCommand(versionInfo.webSocketDebuggerUrl, 'Target.activateTarget', {
        targetId: target.id
    }, 10000)
    await sleep(500)

    console.log(JSON.stringify({
        ok: true,
        activated: true,
        target: {
            id: target.id,
            title: target.title || '',
            url: target.url || ''
        }
    }, null, 2))
})
