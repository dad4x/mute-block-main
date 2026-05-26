#!/usr/bin/env node

const {
    evaluate,
    getCdpConfig,
    getTargets,
    runMain
} = require('./lib/cdp')

runMain(async () => {
    const targets = await getTargets(getCdpConfig())
    const profilePages = targets.filter(target =>
        target.type === 'page' && /^https:\/\/www\.quora\.com\/profile\//i.test(target.url || '')
    )
    const rows = []

    for(const target of profilePages) {
        try {
            const state = await evaluate(target.webSocketDebuggerUrl, `(${function inspectProfilePage() {
                const bodyText = document.body?.innerText || ''
                const controls = Array.from(document.querySelectorAll('button,[role="button"]'))
                    .map(node => (node.innerText || node.getAttribute('aria-label') || node.textContent || '').trim())
                    .filter(Boolean)
                    .slice(0, 80)
                return {
                    readyState: document.readyState,
                    title: document.title,
                    url: location.href,
                    hasBlockedText: /\\bBlocked\\b|\\bUnblock\\b/i.test(bodyText),
                    controls
                }
            }})()`, 10000)
            rows.push({
                targetId: target.id,
                ...state
            })
        }
        catch(error) {
            rows.push({
                targetId: target.id,
                url: target.url || '',
                error: error?.message || `${error || ''}`
            })
        }
    }

    console.log(JSON.stringify({
        profilePageCount: profilePages.length,
        rows
    }, null, 2))
})
