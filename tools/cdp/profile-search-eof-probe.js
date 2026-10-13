#!/usr/bin/env node

const {
    cdpGet,
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
    return `(${function inspectProfileSearchEofProbe() {
        const cleanText = text => `${text || ''}`.replace(/\s+/g, ' ').trim()
        const buttonInfo = selector => {
            const node = document.querySelector(selector)
            if(!node) return null
            const rect = node.getBoundingClientRect()
            return {
                text: cleanText(node.innerText || node.textContent || ''),
                disabled: node.disabled === true,
                visible: rect.width > 0 && rect.height > 0
            }
        }
        const bodyText = cleanText(document.body?.innerText || '')
        const eofPattern = /(?:couldn['’]?t find any more results|no more results|end of results)/ig
        const eofMatches = Array.from(bodyText.matchAll(eofPattern))
            .slice(0, 5)
            .map(match => ({
                text: match[0],
                context: bodyText.slice(Math.max(0, match.index - 120), match.index + match[0].length + 120)
            }))
        const loadingNodes = Array.from(document.querySelectorAll('[role="progressbar"], [aria-busy="true"], [data-testid*="loading" i], [class*="LoadingDots"], [class*="loading" i], [class*="spinner" i]'))
            .filter(node => {
                const rect = node.getBoundingClientRect()
                return rect.width > 0 && rect.height > 0
            })
            .map(node => {
                const rect = node.getBoundingClientRect()
                return {
                    tag: node.tagName,
                    className: `${node.className || ''}`.slice(0, 100),
                    role: node.getAttribute('role') || '',
                    ariaBusy: node.getAttribute('aria-busy') || '',
                    top: Math.round(rect.top),
                    bottom: Math.round(rect.bottom),
                    text: cleanText(node.innerText || node.textContent || '').slice(0, 100)
                }
            })
        const profileLinks = Array.from(document.querySelectorAll('a[href*="/profile/"]'))
            .map(link => link.href)
            .filter(Boolean)
        const uniqueProfileLinks = Array.from(new Set(profileLinks))
        const followButtonCount = Array.from(document.querySelectorAll('button, [role="button"]'))
            .filter(node => /^Follow(?:\\s*·\\s*\\d+)?$/i.test(cleanText(node.innerText || node.textContent || node.getAttribute('aria-label') || '')))
            .length
        const scrollY = Math.round(window.scrollY || document.documentElement.scrollTop || 0)
        const innerHeight = Math.round(window.innerHeight || 0)
        const scrollHeight = Math.round(document.documentElement.scrollHeight || document.body?.scrollHeight || 0)
        return {
            title: document.title,
            readyState: document.readyState,
            visibilityState: document.visibilityState,
            contentReady: document.documentElement.getAttribute('data-mb-content-script-ready') || '',
            scrollY,
            innerHeight,
            scrollHeight,
            atBottom: Math.ceil(scrollY + innerHeight) >= scrollHeight - 2,
            eofMatchCount: eofMatches.length,
            eofMatches,
            loadingNodeCount: loadingNodes.length,
            loadingNodes: loadingNodes.slice(-6),
            uniqueProfileLinkCount: uniqueProfileLinks.length,
            uniqueProfileLinkTail: uniqueProfileLinks.slice(-10),
            followButtonCount,
            rowButtonCount: document.querySelectorAll('.mb-ext_profile-search-row-btn').length,
            batch: buttonInfo('.mb-ext_profile-search-batch-btn'),
            collect: buttonInfo('.mb-ext_profile-search-collect-btn'),
            bodyTail: bodyText.slice(-700)
        }
    }})()`
}

async function scrollToBottom(target) {
    await evaluate(target.webSocketDebuggerUrl, `window.scrollTo({top: document.documentElement.scrollHeight || document.body.scrollHeight || 0, left: 0, behavior: 'auto'}); true`, 15000)
}

async function clickCollect(target) {
    return evaluate(target.webSocketDebuggerUrl, `(${function clickCollectButton() {
        const cleanText = text => `${text || ''}`.replace(/\s+/g, ' ').trim()
        const button = document.querySelector('.mb-ext_profile-search-collect-btn')
        if(!button) return {clicked: false, reason: 'collect-button-not-found'}
        button.scrollIntoView({block: 'center', inline: 'nearest'})
        const before = {
            text: cleanText(button.innerText || button.textContent || ''),
            disabled: button.disabled === true
        }
        button.click()
        return {clicked: true, before}
    }})()`, 15000)
}

runMain(async () => {
    const config = getCdpConfig()
    const needle = getOption('needle', process.env.MB_SEARCH_NEEDLE || '').toLowerCase()
    const durationMs = Math.max(0, Number.parseInt(getOption('duration-ms', '35000'), 10) || 35000)
    const intervalMs = Math.max(500, Number.parseInt(getOption('interval-ms', '5000'), 10) || 5000)
    const shouldCollect = getOption('collect', 'false') === 'true'
    const shouldActivate = getOption('activate', 'false') === 'true'
    const shouldPreScroll = getOption('pre-scroll', shouldCollect ? 'false' : 'true') !== 'false'
    const shouldScrollSamples = getOption('scroll-samples', shouldCollect ? 'false' : 'true') !== 'false'
    const targets = await getTargets(config)
    const target = targets.find(candidate => isProfileSearchTarget(candidate, needle))

    if(!target) {
        console.log(JSON.stringify({ok: false, reason: 'profile-search-target-not-found', needle}, null, 2))
        process.exitCode = 1
        return
    }

    if(shouldActivate) await cdpGet(`/json/activate/${encodeURIComponent(target.id)}`, config, 10000)

    const snapshots = []
    if(shouldPreScroll) {
        await scrollToBottom(target)
        await sleep(900)
    }
    snapshots.push({elapsedMs: 0, phase: 'before-collect', ...(await evaluate(target.webSocketDebuggerUrl, inspectExpression(), 15000))})

    let collect = null
    if(shouldCollect) {
        collect = await clickCollect(target)
    }

    const startedAt = Date.now()
    let nextSampleAt = 0
    while(Date.now() - startedAt <= durationMs) {
        const elapsedMs = Date.now() - startedAt
        if(elapsedMs >= nextSampleAt) {
            if(shouldScrollSamples) {
                await scrollToBottom(target)
                await sleep(300)
            }
            snapshots.push({elapsedMs, phase: shouldCollect ? 'after-collect' : 'sample', ...(await evaluate(target.webSocketDebuggerUrl, inspectExpression(), 15000))})
            nextSampleAt += intervalMs
        }
        await sleep(Math.min(500, Math.max(100, nextSampleAt - elapsedMs)))
    }

    console.log(JSON.stringify({
        ok: true,
        target: {id: target.id, title: target.title || '', url: target.url || ''},
        collect,
        snapshots
    }, null, 2))
})
