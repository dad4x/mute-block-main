#!/usr/bin/env node

const {
    cdpCommand,
    getCdpConfig,
    getJson,
    getOption,
    runMain,
    sleep
} = require('./lib/cdp')

runMain(async () => {
    const url = getOption('url', '')
    if(!url) throw new Error('missing --url')

    const config = getCdpConfig()
    const versionInfo = await getJson('/json/version', config)
    const result = await cdpCommand(versionInfo.webSocketDebuggerUrl, 'Target.createTarget', {
        url,
        background: true
    })
    await sleep(500)
    console.log(JSON.stringify({opened: true, url, targetId: result.targetId || ''}, null, 2))
})
