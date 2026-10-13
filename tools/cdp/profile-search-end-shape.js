#!/usr/bin/env node

const {
    evaluate,
    getCdpConfig,
    getOption,
    getTargets,
    runMain,
    sleep
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

function inspectExpression() {
    return `(${function inspectProfileSearchEndShape() {
        const cleanText = text => `${text || ''}`.replace(/\s+/g, ' ').trim()
        const links = Array.from(document.querySelectorAll('a[href*="/profile/"]'))
            .map(link => link.href)
            .filter(Boolean)
        const uniqueLinks = Array.from(new Set(links))
        const buttons = Array.from(document.querySelectorAll('button, [role="button"]'))
        const followButtons = buttons.filter(node => /^Follow(?:\\s*·\\s*\\d+)?$/i.test(cleanText(node.innerText || node.textContent || node.getAttribute('aria-label') || '')))
        const profileRows = Array.from(document.querySelectorAll('[data-mb-profile-search-href]'))
            .map((row, index) => {
                const rect = row.getBoundingClientRect()
                return {
                    index,
                    href: row.dataset.mbProfileSearchHref || '',
                    text: cleanText(row.innerText || row.textContent || '').slice(0, 180),
                    top: Math.round(rect.top),
                    bottom: Math.round(rect.bottom),
                    height: Math.round(rect.height)
                }
            })
        const loadingNodes = Array.from(document.querySelectorAll('[role="progressbar"], [aria-busy="true"], [data-testid*="loading" i], [class*="loading" i], [class*="spinner" i]'))
            .filter(node => {
                const rect = node.getBoundingClientRect()
                return rect.width > 0 && rect.height > 0
            })
            .map(node => {
                const rect = node.getBoundingClientRect()
                return {
                    tag: node.tagName,
                    role: node.getAttribute('role') || '',
                    ariaBusy: node.getAttribute('aria-busy') || '',
                    className: `${node.className || ''}`.slice(0, 120),
                    text: cleanText(node.innerText || node.textContent || '').slice(0, 120),
                    top: Math.round(rect.top),
                    bottom: Math.round(rect.bottom)
                }
            })
        const bodyText = cleanText(document.body?.innerText || '')
        return {
            url: location.href,
            title: document.title,
            readyState: document.readyState,
            visibilityState: document.visibilityState,
            contentReady: document.documentElement.getAttribute('data-mb-content-script-ready') || '',
            scrollY: Math.round(window.scrollY || document.documentElement.scrollTop || 0),
            innerHeight: Math.round(window.innerHeight || 0),
            scrollHeight: Math.round(document.documentElement.scrollHeight || document.body?.scrollHeight || 0),
            atBottom: Math.ceil((window.scrollY || document.documentElement.scrollTop || 0) + (window.innerHeight || 0)) >= Math.floor(document.documentElement.scrollHeight || document.body?.scrollHeight || 0) - 2,
            uniqueProfileLinkCount: uniqueLinks.length,
            uniqueProfileLinkTail: uniqueLinks.slice(-15),
            followButtonCount: followButtons.length,
            rowButtonCount: document.querySelectorAll('.mb-ext_profile-search-row-btn').length,
            profileRowCount: profileRows.length,
            profileRowTail: profileRows.slice(-10),
            loadingNodes,
            bodyTail: bodyText.slice(-1200)
        }
    }})()`
}

async function scrollToBottom(target, passes) {
    const snapshots = []
    for(let index = 0; index < passes; index += 1) {
        const before = await evaluate(target.webSocketDebuggerUrl, inspectExpression(), 15000)
        snapshots.push({pass: index, phase: 'before', ...before})
        await evaluate(target.webSocketDebuggerUrl, `window.scrollTo({top: document.documentElement.scrollHeight || document.body.scrollHeight || 0, left: 0, behavior: 'auto'}); true`, 15000)
        await sleep(900)
        const after = await evaluate(target.webSocketDebuggerUrl, inspectExpression(), 15000)
        snapshots.push({pass: index, phase: 'after', ...after})
        if(after.atBottom &&
            after.scrollHeight === before.scrollHeight &&
            after.uniqueProfileLinkCount === before.uniqueProfileLinkCount &&
            !after.loadingNodes.length) {
            break
        }
    }
    return snapshots
}

runMain(async () => {
    const config = getCdpConfig()
    const needle = getOption('needle', process.env.MB_SEARCH_NEEDLE || '').toLowerCase()
    const passes = Math.max(1, Number.parseInt(getOption('passes', '8'), 10) || 8)
    const targets = await getTargets(config)
    const target = targets.find(candidate => isProfileSearchTarget(candidate, needle))

    if(!target) {
        console.log(JSON.stringify({ok: false, reason: 'profile-search-target-not-found', needle}, null, 2))
        process.exitCode = 1
        return
    }

    const snapshots = await scrollToBottom(target, passes)
    console.log(JSON.stringify({
        ok: true,
        target: {id: target.id, title: target.title || '', url: target.url || ''},
        snapshots
    }, null, 2))
})
