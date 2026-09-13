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
    const results = []

    for(const target of profilePages) {
        const result = await evaluate(target.webSocketDebuggerUrl, `(${function clickBlockConfirm() {
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
            const textOf = node => `${node?.innerText || node?.textContent || node?.getAttribute?.('aria-label') || ''}`
                .replace(/\s+/g, ' ')
                .trim()
            const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]'))
                .filter(visible)
            const dialog = dialogs.find(candidate => /^Block\b/i.test(textOf(candidate))) || dialogs[0] || null
            if(!dialog) {
                return {
                    clicked: false,
                    reason: 'dialog-not-found',
                    url: location.href,
                    title: document.title
                }
            }

            const buttons = Array.from(dialog.querySelectorAll('button, [role="button"]'))
                .filter(visible)
            const button = buttons.find(candidate => /^Block$/i.test(textOf(candidate)))
            if(!button) {
                return {
                    clicked: false,
                    reason: 'block-button-not-found',
                    dialogText: textOf(dialog).slice(0, 500),
                    url: location.href,
                    title: document.title
                }
            }

            button.click()
            return {
                clicked: true,
                text: textOf(button),
                url: location.href,
                title: document.title
            }
        }})()`, 10000)
        results.push({
            id: target.id,
            url: target.url || '',
            ...result
        })
    }

    console.log(JSON.stringify({matched: profilePages.length, results}, null, 2))
})
