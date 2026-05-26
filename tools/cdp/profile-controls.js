#!/usr/bin/env node

const {
    evaluate,
    getCdpConfig,
    getOption,
    getTargets,
    runMain
} = require('./lib/cdp')

runMain(async () => {
    const needle = getOption('needle', process.env.MB_PROFILE_NEEDLE || '').toLowerCase()
    const targets = await getTargets(getCdpConfig())
    const profilePages = targets.filter(target =>
        target.type === 'page' &&
        /^https:\/\/www\.quora\.com\/profile\//i.test(target.url || '') &&
        (!needle || `${target.url || ''} ${target.title || ''}`.toLowerCase().includes(needle))
    )
    const rows = []

    for(const target of profilePages) {
        const controls = await evaluate(target.webSocketDebuggerUrl, `(${function inspectControls() {
            return Array.from(document.querySelectorAll('button,[role="button"],a'))
                .map((node, index) => {
                    const rect = node.getBoundingClientRect()
                    return {
                        index,
                        tag: node.tagName,
                        role: node.getAttribute('role') || '',
                        text: (node.innerText || node.textContent || '').trim().slice(0, 120),
                        aria: node.getAttribute('aria-label') || '',
                        href: node.getAttribute('href') || '',
                        rect: {
                            x: Math.round(rect.x),
                            y: Math.round(rect.y),
                            w: Math.round(rect.width),
                            h: Math.round(rect.height)
                        }
                    }
                })
                .filter(item => item.text || item.aria || item.href)
                .slice(0, 160)
        }})()`, 20000)
        rows.push({
            targetId: target.id,
            title: target.title || '',
            url: target.url || '',
            controls
        })
    }

    console.log(JSON.stringify({
        profilePageCount: profilePages.length,
        rows
    }, null, 2))
})
