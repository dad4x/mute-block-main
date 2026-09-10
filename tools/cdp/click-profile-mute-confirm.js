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
        const result = await evaluate(target.webSocketDebuggerUrl, `(${function clickMuteConfirm() {
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
            const buttons = Array.from(document.querySelectorAll('button, [role="button"], a'))
                .filter(visible)
                .filter(button => /^confirm$/i.test(textOf(button)))
                .map(button => {
                    let current = button.parentElement
                    let contextText = ''
                    while(current && current !== document.body) {
                        const text = textOf(current)
                        if(/\bmuted\b|\bmuting this person\b/i.test(text)) {
                            contextText = text
                            break
                        }
                        current = current.parentElement
                    }
                    return {button, contextText}
                })
                .filter(candidate => /\bmuted\b|\bmuting this person\b/i.test(candidate.contextText))

            const button = buttons[0]?.button || null
            if(!button) {
                return {
                    clicked: false,
                    reason: 'mute-confirm-not-found',
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
