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
    const extensionsPage = targets.find(target => target.url === 'chrome://extensions/')
    if(!extensionsPage) {
        console.log(JSON.stringify({extensionsPage: false}, null, 2))
        return
    }

    const result = await evaluate(extensionsPage.webSocketDebuggerUrl, `(${async function probeInspectOptions(extensionId) {
        const candidates = [
            {},
            {renderViewId: -1},
            {renderProcessId: -1},
            {processId: -1, viewId: -1},
            {render_process_id: -1, render_view_id: -1},
            {extension_id: extensionId, incognito: false, render_process_id: -1, render_view_id: -1},
            {extension_id: extensionId, incognito: false, render_process_id: -1, render_view_id: 0},
            {extension_id: extensionId, incognito: false, render_process_id: 0, render_view_id: 0},
            {extension_id: extensionId, incognito: false, render_process_id: 8, render_view_id: 12},
            {extension_id: 'x'},
            {extensionId: 'x'},
            {url: 'chrome-extension://x/js/sw.js'}
        ]
        const results = []
        for(const options of candidates) {
            try {
                await new Promise(resolve => {
                    chrome.developerPrivate.inspect(options, () => resolve())
                })
                results.push({options, ok: !chrome.runtime.lastError, lastError: chrome.runtime.lastError ? chrome.runtime.lastError.message : ''})
            }
            catch(error) {
                results.push({options, ok: false, thrown: error?.message || String(error || '')})
            }
        }
        return results
    }})(${JSON.stringify(config.extensionId)})`, 10000)

    console.log(JSON.stringify(result, null, 2))
})
