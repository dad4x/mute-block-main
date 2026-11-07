// Opening the extension's own pages from an extension page (6 Nov): the dashboard, the History page and the preferences page. Each has one
// tab. The page looks for its open tab and reuses it; otherwise it creates one in the window the page is in. No message goes through the
// worker, whose queue can be busy for seconds during a run. The open is reported to the worker's recorder by the caller, as a page event
// with its timing.

const PAGES = {
    dashboard: {file: 'coordinator.html', hash: ''},
    history: {file: 'coordinator.html', hash: '#history'},
    preferences: {file: 'preferences.html', hash: ''}
}

// `browserApi` is the extension API the page has (the global browser on the coordinator page, the polyfill on preferences).
// `page` is one of PAGES' keys. Returns {tabId, reused}. `report(detail)` is optional.
async function openExtensionPageFromHere(browserApi, {page = 'dashboard', clickedAt = Date.now(), report = null} = {}) {
    const target = PAGES[page] || PAGES.dashboard
    const currentWindow = await browserApi.windows.getCurrent().catch(() => null)
    const pageUrl = browserApi.runtime.getURL(target.file)
    const wantedUrl = `${pageUrl}${target.hash}`
    const matches = await browserApi.tabs.query({url: pageUrl}).catch(() => [])
    // tabs.query ignores the hash, so the match is checked against the full address: History is coordinator.html#history, not the dashboard.
    const existing = matches.find(tab => tab?.id && `${tab.url || ''}` === wantedUrl)
    let tab = null
    if(existing) {
        tab = await browserApi.tabs.update(existing.id, {active: true}).catch(() => null)
        if(existing.windowId) await browserApi.windows.update(existing.windowId, {focused: true}).catch(() => null)
    }
    else {
        tab = await browserApi.tabs.create({url: wantedUrl, active: true, windowId: currentWindow?.id || undefined})
            .catch(() => browserApi.tabs.create({url: wantedUrl, active: true}))
            .catch(() => null)
    }
    const reused = !!existing
    if(typeof report === 'function') {
        report(`${page} ${reused ? 'reused' : 'created'} ${tab?.id ? 'tab' : 'failed'} ${Date.now() - clickedAt}ms`)
    }
    return {tabId: tab?.id || null, reused}
}

module.exports = {PAGES, openExtensionPageFromHere}
