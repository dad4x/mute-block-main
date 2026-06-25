#!/usr/bin/env node

const {
    evaluate,
    getCdpConfig,
    getOption,
    getTargets,
    runMain
} = require('./lib/cdp')

function getClickExtensionActionPageFunction() {
    return function clickExtensionAction(closeAfter) {
        const visibleText = value => {
            if(typeof value === 'string') return value
                .replace(/\s+/g, ' ')
                .trim()
            return `${value?.innerText || value?.textContent || value?.getAttribute?.('aria-label') || ''}`
                .replace(/\s+/g, ' ')
                .trim()
        }
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
        const buttons = Array.from(document.querySelectorAll('button, [role="button"]'))
            .filter(visible)
            .map((node, index) => ({
                node,
                index,
                text: visibleText(node),
                aria: visibleText(node.getAttribute('aria-label') || ''),
                title: visibleText(node.getAttribute('title') || '')
            }))
        const button = buttons.find(item => {
            const label = `${item.text}\n${item.aria}\n${item.title}`
            if(closeAfter) return /Mute-Block Extension: Mute and block this profile, then close the tab/i.test(label) ||
                /Mute-Block Extension: Close this tab/i.test(label)
            return /Mute-Block Extension: Mute and block this profile$/i.test(label) ||
                /^Mute Block$/i.test(item.text)
        })
        if(!button) {
            return {
                clicked: false,
                reason: 'extension-action-button-not-found',
                url: location.href,
                title: document.title,
                visibilityState: document.visibilityState,
                buttons: buttons.map(({node, ...rest}) => rest).slice(0, 40)
            }
        }

        button.node.click()
        return {
            clicked: true,
            url: location.href,
            title: document.title,
            visibilityState: document.visibilityState,
            button: {
                index: button.index,
                text: button.text,
                aria: button.aria,
                title: button.title
            }
        }
    }
}

async function main() {
    const config = getCdpConfig()
    const needle = getOption('needle', '').toLowerCase()
    const closeAfter = getOption('close-after', 'false') === 'true'
    const targets = await getTargets(config)
    const profilePages = targets.filter(target => {
        if(target.type !== 'page') return false
        if(!/^https:\/\/www\.quora\.com\/profile\//i.test(target.url || '')) return false
        if(!needle) return true
        return `${target.url || ''}\n${target.title || ''}`.toLowerCase().includes(needle)
    })

    if(profilePages.length !== 1) {
        console.log(JSON.stringify({
            matched: profilePages.length,
            pages: profilePages.map(target => ({
                id: target.id,
                title: target.title || '',
                url: target.url || ''
            }))
        }, null, 2))
        process.exitCode = 1
        return
    }

    const target = profilePages[0]
    const result = await evaluate(target.webSocketDebuggerUrl, `(${getClickExtensionActionPageFunction().toString()})( ${JSON.stringify(closeAfter)} )`, 10000)

    console.log(JSON.stringify({
        tab: {
            id: target.id,
            title: target.title || '',
            url: target.url || ''
        },
        result
    }, null, 2))
}

if(require.main === module) {
    runMain(main)
}

module.exports = {
    getClickExtensionActionPageFunction
}
