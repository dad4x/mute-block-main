#!/usr/bin/env node

const {
    evaluate,
    getCdpConfig,
    getOption,
    getTargets,
    runMain
} = require('./lib/cdp')

runMain(async () => {
    const config = getCdpConfig()
    const needle = getOption('needle', '').toLowerCase()
    const targets = await getTargets(config)
    const profilePages = targets.filter(target => {
        if(target.type !== 'page') return false
        if(!/^https:\/\/www\.quora\.com\/profile\//i.test(target.url || '')) return false
        if(!needle) return true
        return `${target.url || ''}\n${target.title || ''}`.toLowerCase().includes(needle)
    })
    const rows = []

    for(const target of profilePages) {
        const result = await evaluate(target.webSocketDebuggerUrl, `(${function inspectConfirmSurfaces() {
            const textOf = node => `${node?.innerText || node?.textContent || node?.getAttribute?.('aria-label') || ''}`
                .replace(/\s+/g, ' ')
                .trim()
            const visible = node => {
                if(!node) return false
                const rect = node.getBoundingClientRect()
                const style = window.getComputedStyle(node)
                return rect.width > 0 &&
                    rect.height > 0 &&
                    style.visibility !== 'hidden' &&
                    style.display !== 'none' &&
                    Number(style.opacity || '1') !== 0
            }
            const describe = node => {
                if(!node) return null
                const rect = node.getBoundingClientRect()
                const style = window.getComputedStyle(node)
                return {
                    tag: node.tagName,
                    role: node.getAttribute('role') || '',
                    aria: node.getAttribute('aria-label') || '',
                    className: `${node.className || ''}`,
                    text: textOf(node).slice(0, 400),
                    rect: {
                        x: Math.round(rect.x),
                        y: Math.round(rect.y),
                        w: Math.round(rect.width),
                        h: Math.round(rect.height)
                    },
                    display: style.display,
                    visibility: style.visibility,
                    pointerEvents: style.pointerEvents,
                    cursor: style.cursor,
                    tabIndex: node.tabIndex
                }
            }
            const all = Array.from(document.querySelectorAll('body *'))
            const confirmNodes = all
                .filter(visible)
                .filter(node => /^confirm$/i.test(textOf(node)))
                .map(node => {
                    const ancestors = []
                    let current = node.parentElement
                    while(current && ancestors.length < 5) {
                        ancestors.push(describe(current))
                        current = current.parentElement
                    }
                    return {
                        node: describe(node),
                        ancestors
                    }
                })
            const mutedContainers = all
                .filter(visible)
                .filter(node => /\bmuted\b|\bmuting this person\b/i.test(textOf(node)))
                .map(describe)
                .sort((left, right) => (left.rect.w * left.rect.h) - (right.rect.w * right.rect.h))
                .slice(0, 12)

            return {
                url: location.href,
                title: document.title,
                confirmNodes,
                mutedContainers
            }
        }})()`, 10000)
        rows.push({
            targetId: target.id,
            url: target.url || '',
            title: target.title || '',
            ...result
        })
    }

    console.log(JSON.stringify({profilePageCount: profilePages.length, rows}, null, 2))
})
