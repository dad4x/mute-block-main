#!/usr/bin/env node

const {
    cdpCommand,
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
    return `(${function inspectProfileSearchControls() {
        const cleanText = text => `${text || ''}`.replace(/\s+/g, ' ').trim()
        const buttonInfo = selector => {
            const node = document.querySelector(selector)
            if(!node) return null
            const rect = node.getBoundingClientRect()
            const computed = window.getComputedStyle(node)
            return {
                found: true,
                text: cleanText(node.innerText || node.textContent || ''),
                disabled: node.disabled === true,
                visible: rect.width > 0 && rect.height > 0,
                rect: {
                    x: Math.round(rect.x),
                    y: Math.round(rect.y),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height)
                },
                style: {
                    backgroundColor: computed.backgroundColor,
                    color: computed.color,
                    borderColor: computed.borderColor,
                    borderRadius: computed.borderRadius
                }
            }
        }
        const rowButtons = Array.from(document.querySelectorAll('.mb-ext_profile-search-row-btn'))
            .map((node, index) => ({
                index,
                href: node.dataset.mbProfileSearchHref || '',
                text: cleanText(node.innerText || node.textContent || ''),
                disabled: node.disabled === true
            }))
        const links = Array.from(document.querySelectorAll('a[href*="/profile/"]'))
            .map(link => link.href)
            .filter(Boolean)
        const uniqueLinks = Array.from(new Set(links))
        const followRows = Array.from(document.querySelectorAll('button, [role="button"]'))
            .filter(node => /^Follow$/i.test(cleanText(node.innerText || node.textContent || node.getAttribute('aria-label') || '')))
            .length
        return {
            url: location.href,
            title: document.title,
            readyState: document.readyState,
            visibilityState: document.visibilityState,
            contentReady: document.documentElement.getAttribute('data-mb-content-script-ready') || '',
            scrollY: Math.round(window.scrollY || document.documentElement.scrollTop || 0),
            innerHeight: Math.round(window.innerHeight || 0),
            scrollHeight: Math.round(document.documentElement.scrollHeight || document.body?.scrollHeight || 0),
            toolbar: !!document.querySelector('.mb-ext_profile-search-toolbar'),
            batch: buttonInfo('.mb-ext_profile-search-batch-btn'),
            collect: buttonInfo('.mb-ext_profile-search-collect-btn'),
            rowButtonCount: rowButtons.length,
            rowButtonSamples: rowButtons.slice(0, 25),
            followRows,
            uniqueProfileLinkCount: uniqueLinks.length,
            uniqueProfileLinkSamples: uniqueLinks.slice(0, 30),
            bodyText: cleanText(document.body?.innerText || '').slice(0, 800)
        }
    }})()`
}

async function clickButton(target, selector, useInput) {
    const before = await evaluate(target.webSocketDebuggerUrl, inspectExpression(), 15000)
    if(useInput) {
        const button = selector.includes('collect') ? before.collect : before.batch
        if(!button?.found || !button.visible) {
            return {clicked: false, reason: 'button-not-visible', before}
        }
        const x = button.rect.x + Math.max(1, Math.floor(button.rect.width / 2))
        const y = button.rect.y + Math.max(1, Math.floor(button.rect.height / 2))
        await cdpCommand(target.webSocketDebuggerUrl, 'Input.dispatchMouseEvent', {
            type: 'mousePressed',
            x,
            y,
            button: 'left',
            buttons: 1,
            clickCount: 1
        }, 10000)
        await cdpCommand(target.webSocketDebuggerUrl, 'Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            x,
            y,
            button: 'left',
            buttons: 0,
            clickCount: 1
        }, 10000)
        return {clicked: true, method: 'input', x, y, before}
    }

    const clicked = await evaluate(target.webSocketDebuggerUrl, `(${function clickProfileSearchButton(buttonSelector) {
        const button = document.querySelector(buttonSelector)
        if(!button) return {clicked: false, reason: 'button-not-found'}
        button.scrollIntoView({block: 'center', inline: 'nearest'})
        button.click()
        return {
            clicked: true,
            text: `${button.innerText || button.textContent || ''}`.replace(/\s+/g, ' ').trim(),
            disabled: button.disabled === true
        }
    }})( ${JSON.stringify(selector)} )`, 15000)
    return {...clicked, method: 'dom', before}
}

runMain(async () => {
    const config = getCdpConfig()
    const needle = getOption('needle', process.env.MB_SEARCH_NEEDLE || '').toLowerCase()
    const action = getOption('action', 'state')
    const useInput = getOption('input', 'false') === 'true'
    const waitMs = Number.parseInt(getOption('wait-ms', '1500'), 10) || 1500
    const targets = await getTargets(config)
    const target = targets.find(candidate => isProfileSearchTarget(candidate, needle))

    if(!target) {
        console.log(JSON.stringify({ok: false, reason: 'profile-search-target-not-found', needle}, null, 2))
        process.exitCode = 1
        return
    }

    let click = null
    if(action === 'collect') click = await clickButton(target, '.mb-ext_profile-search-collect-btn', useInput)
    else if(action === 'batch') click = await clickButton(target, '.mb-ext_profile-search-batch-btn', useInput)
    else if(action === 'row') click = await clickButton(target, '.mb-ext_profile-search-row-btn', useInput)
    else if(action !== 'state') {
        console.log(JSON.stringify({ok: false, reason: 'unknown-action', action}, null, 2))
        process.exitCode = 1
        return
    }

    if(click) await sleep(waitMs)
    const state = await evaluate(target.webSocketDebuggerUrl, inspectExpression(), 15000)
    console.log(JSON.stringify({
        ok: true,
        action,
        target: {id: target.id, title: target.title || '', url: target.url || ''},
        click,
        state
    }, null, 2))
})
