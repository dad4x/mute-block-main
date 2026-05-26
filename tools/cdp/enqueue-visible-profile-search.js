#!/usr/bin/env node

const {
    evaluate,
    getCdpConfig,
    getOption,
    getTargets,
    runMain
} = require('./lib/cdp')

function isProfileSearchTarget(target, needle) {
    if(target.type !== 'page') return false
    const url = target.url || ''
    if(!/^https:\/\/www\.quora\.com\/search\?/i.test(url)) return false
    try {
        const parsed = new URL(url)
        if((parsed.searchParams.get('type') || '').toLowerCase() !== 'profile') return false
        if(!needle) return true
        return [url, target.title || ''].join('\n').toLowerCase().includes(needle)
    }
    catch {
        return false
    }
}

runMain(async () => {
    const config = getCdpConfig()
    const needle = getOption('needle', process.env.MB_SEARCH_NEEDLE || '').toLowerCase()
    const limit = Math.max(1, Number.parseInt(getOption('limit', '3'), 10) || 3)
    const maxConcurrent = Math.max(1, Number.parseInt(getOption('max-concurrent', '1'), 10) || 1)
    const noForegroundFallback = getOption('no-foreground-fallback', 'true') !== 'false'
    const explicitUrls = getOption('urls', '')
        .split(',')
        .map(entry => entry.trim())
        .filter(Boolean)
    const targets = await getTargets(config)
    const target = targets.find(candidate => isProfileSearchTarget(candidate, needle))
    const dashboardUrl = `chrome-extension://${config.extensionId}/coordinator.html`
    const extensionPage = targets.find(candidate => candidate.type === 'page' && candidate.url === dashboardUrl) ||
        targets.find(candidate => candidate.type === 'page' && (candidate.url || '').startsWith(`chrome-extension://${config.extensionId}/`))

    if(!target) {
        console.log(JSON.stringify({ok: false, reason: 'profile-search-target-not-found', needle}, null, 2))
        process.exitCode = 1
        return
    }
    if(!extensionPage) {
        console.log(JSON.stringify({ok: false, reason: 'extension-page-not-found'}, null, 2))
        process.exitCode = 1
        return
    }

    const visible = explicitUrls.length
        ? {pageUrl: target.url || '', title: target.title || '', searchQuery: needle, links: explicitUrls}
        : await evaluate(target.webSocketDebuggerUrl, `(${function collectVisibleProfileSearchLinks() {
        const normalizeProfileHref = href => {
            try {
                const parsed = new URL(href, location.href)
                if(!/^(www\.)?quora\.com$/i.test(parsed.hostname)) return ''
                const match = parsed.pathname.match(/^\/profile\/([^/?#]+)/i)
                if(!match) return ''
                return `https://www.quora.com/profile/${match[1]}`
            }
            catch {
                return ''
            }
        }
        const links = Array.from(document.querySelectorAll('a[href*="/profile/"]'))
            .map(link => normalizeProfileHref(link.href))
            .filter(Boolean)
        return {
            pageUrl: location.href,
            title: document.title || '',
            searchQuery: new URLSearchParams(location.search).get('q') || '',
            links: Array.from(new Set(links))
        }
    }})()`, 15000)

    const result = await evaluate(extensionPage.webSocketDebuggerUrl, `(${function enqueueVisibleProfileSearch(visible, limit, maxConcurrent, noForegroundFallback) {
        const sendMessage = message => new Promise(resolve => {
            let settled = false
            const finish = value => {
                if(settled) return
                settled = true
                resolve(value)
            }
            setTimeout(() => finish({timedOut: true}), 15000)
            chrome.runtime.sendMessage(message, response => finish({
                response: response || null,
                lastError: chrome.runtime.lastError ? chrome.runtime.lastError.message : ''
            }))
        })
        const unique = Array.isArray(visible?.links) ? visible.links : []
        const runId = `manual-visible-profile-search-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const source = {
            type: 'profile-search',
            pageUrl: visible?.pageUrl || '',
            searchQuery: visible?.searchQuery || '',
            sourceLabel: visible?.title || ''
        }

        return chrome.storage.local.get({mbCoordinatorQueue: {}, mbProfileNukeProgress: {}}).then(async stored => {
            const queue = stored.mbCoordinatorQueue || {}
            const progress = stored.mbProfileNukeProgress || {}
            const selected = unique.filter(href => {
                const row = queue[href]
                const record = progress[href]
                if(['queued', 'opening', 'active', 'acting', 'settling'].includes(`${row?.status || ''}`)) return false
                if(['succeeded', 'skipped', 'canceled'].includes(`${row?.status || ''}`)) return false
                if(record?.blockSucceeded === true || ['blocked', 'already-blocked', 'succeeded'].includes(`${record?.status || ''}`)) return false
                return true
            }).slice(0, limit)

            if(!selected.length) {
                return {
                    ok: false,
                    reason: 'no-new-visible-profile-links',
                    visibleCount: unique.length,
                    selected
                }
            }

            const message = {
                action: 'enqueue-coordinator-items',
                run: {
                    id: runId,
                    sourceType: 'profile-search',
                    sourcePageUrl: visible?.pageUrl || ''
                },
                source,
                execute: {
                    tabAction: 'nuke',
                    maxConcurrent,
                    noForegroundFallback
                },
                items: selected.map(profileHref => ({
                    runId,
                    dedupeKey: profileHref,
                    targetProfileHref: profileHref,
                    requestedUrl: profileHref,
                    source
                }))
            }
            const response = await sendMessage(message)
            return {
                ok: true,
                runId,
                selected,
                visibleCount: unique.length,
                noForegroundFallback,
                maxConcurrent,
                response
            }
        })
    }})( ${JSON.stringify(visible)}, ${JSON.stringify(limit)}, ${JSON.stringify(maxConcurrent)}, ${JSON.stringify(noForegroundFallback)} )`, 30000)

    console.log(JSON.stringify({
        target: {id: target.id, title: target.title || '', url: target.url || ''},
        extensionPage: {id: extensionPage.id, title: extensionPage.title || '', url: extensionPage.url || ''},
        ...result
    }, null, 2))
})
