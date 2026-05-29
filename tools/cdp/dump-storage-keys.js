#!/usr/bin/env node

const {
    evaluate,
    getCdpConfig,
    getOption,
    getTargets,
    runMain
} = require('./lib/cdp')

function parseKeys() {
    return getOption('keys', '')
        .split(',')
        .map(key => key.trim())
        .filter(Boolean)
}

function findExtensionTarget(targets = [], config = getCdpConfig()) {
    const extensionPrefix = `chrome-extension://${config.extensionId}/`
    return targets.find(target => target.type === 'page' && target.url === `${extensionPrefix}coordinator.html`) ||
        targets.find(target => target.type === 'page' && (target.url || '').startsWith(extensionPrefix)) ||
        targets.find(target => target.type === 'service_worker' && (target.url || '').startsWith(extensionPrefix))
}

runMain(async () => {
    const config = getCdpConfig()
    const keys = parseKeys()
    if(!keys.length) {
        console.error('Usage: dump-storage-keys.js --keys key1,key2')
        process.exitCode = 2
        return
    }

    const targets = await getTargets(config)
    const target = findExtensionTarget(targets, config)
    if(!target) {
        console.log(JSON.stringify({extensionTarget: false}, null, 2))
        process.exitCode = 1
        return
    }

    const result = await evaluate(target.webSocketDebuggerUrl, `(${async function dumpKeys(keysToRead) {
        const stored = await chrome.storage.local.get(Object.fromEntries(keysToRead.map(key => [key, null])))
        return Object.fromEntries(keysToRead.map(key => [key, stored?.[key] ?? null]))
    }})( ${JSON.stringify(keys)} )`, 30000)

    console.log(JSON.stringify({
        extensionTarget: true,
        target: {
            id: target.id,
            type: target.type,
            title: target.title || '',
            url: target.url || ''
        },
        values: result
    }, null, 2))
})
