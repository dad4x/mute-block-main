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
    const tab = targets.find(target => {
        if(target.type !== 'page') return false
        if(!/^https:\/\/www\.quora\.com\/profile\//i.test(target.url || '')) return false
        if(!needle) return true
        return [target.url || '', target.title || ''].join('\n').toLowerCase().includes(needle)
    })

    if(!tab) {
        console.log(JSON.stringify({tab: false}, null, 2))
        process.exitCode = 1
        return
    }

    const result = await evaluate(tab.webSocketDebuggerUrl, `(${function inspectProfileActionState() {
        const visibleText = text => `${text || ''}`.replace(/\\s+/g, ' ').trim()
        const all = selector => Array.from(document.querySelectorAll(selector))
        const describeNode = (node, index) => {
            const rect = node.getBoundingClientRect()
            return {
                index,
                tag: node.tagName,
                role: node.getAttribute('role') || '',
                text: visibleText(node.innerText || node.textContent || node.getAttribute('aria-label') || ''),
                aria: visibleText(node.getAttribute('aria-label') || ''),
                title: visibleText(node.getAttribute('title') || ''),
                disabled: !!node.disabled || node.getAttribute('aria-disabled') === 'true',
                hidden: node.offsetParent === null,
                rect: {
                    top: Math.round(rect.top),
                    left: Math.round(rect.left),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height)
                }
            }
        }
        const buttons = all('button, [role="button"], [role="menuitem"], a')
            .map(describeNode)
            .filter(item => /mute|unmute|block|unblock|more|follow|following|\\.\\.\\.|⋯/i.test([
                item.text,
                item.aria,
                item.title,
                item.role
            ].join(' ')))
            .slice(0, 80)
        const menus = all('[role="menu"], [data-popper-placement]')
            .map((node, index) => ({
                index,
                role: node.getAttribute('role') || '',
                placement: node.getAttribute('data-popper-placement') || '',
                text: visibleText(node.innerText || node.textContent || '').slice(0, 1000),
                hidden: node.offsetParent === null,
                items: Array.from(node.querySelectorAll('button, [role="button"], [role="menuitem"], a'))
                    .map(describeNode)
                    .slice(0, 40)
            }))
            .filter(item => !item.hidden || /mute|unmute|block|unblock/i.test(item.text))
            .slice(0, 20)
        const dialogs = all('[role="dialog"], [aria-modal="true"]')
            .map((node, index) => ({
                index,
                text: visibleText(node.innerText || node.textContent || '').slice(0, 1000),
                hidden: node.offsetParent === null
            }))
        return {
            url: location.href,
            title: document.title,
            readyState: document.readyState,
            visibilityState: document.visibilityState,
            contentReady: document.documentElement.getAttribute('data-mb-content-script-ready') || '',
            bodyText: visibleText(document.body?.innerText || '').slice(0, 1500),
            buttons,
            menus,
            dialogs
        }
    }} )()`, 20000)

    console.log(JSON.stringify({
        tab: {
            id: tab.id,
            title: tab.title || '',
            url: tab.url || ''
        },
        state: result
    }, null, 2))
})
