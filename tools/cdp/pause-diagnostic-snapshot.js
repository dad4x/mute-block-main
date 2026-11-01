#!/usr/bin/env node

const {PAUSE_DIAGNOSTIC_SNAPSHOT_KEY, STORAGE_LAYOUT_PREFIX} = require('../../shared/js/storageKeys')

// The stored name of the snapshot: the layout prefix plus the plain key name (storageNamespace.js).
const SNAPSHOT_STORED_KEY = `${STORAGE_LAYOUT_PREFIX}${PAUSE_DIAGNOSTIC_SNAPSHOT_KEY}`

const {
    evaluate,
    getCdpConfig,
    getTargets,
    runMain
} = require('./lib/cdp')

runMain(async () => {
    const config = getCdpConfig()
    const targets = await getTargets(config)
    const dashboardUrl = `chrome-extension://${config.extensionId}/coordinator.html`
    const extensionPage = targets.find(target => target.type === 'page' && target.url === dashboardUrl) ||
        targets.find(target => target.type === 'page' && (target.url || '').startsWith(`chrome-extension://${config.extensionId}/`))
    if(!extensionPage) {
        console.log(JSON.stringify({error: 'no extension page target found -- open the dashboard first'}, null, 2))
        return
    }

    const result = await evaluate(extensionPage.webSocketDebuggerUrl, `(${function readSnapshot(key) {
        return new Promise(resolve => {
            chrome.storage.local.get({[key]: null}, storage => {
                resolve({
                    lastError: chrome.runtime.lastError ? chrome.runtime.lastError.message : '',
                    snapshot: storage?.[key] || null
                })
            })
        })
    }})(${JSON.stringify(SNAPSHOT_STORED_KEY)})`, 10000)

    console.log(JSON.stringify(result, null, 2))
})
