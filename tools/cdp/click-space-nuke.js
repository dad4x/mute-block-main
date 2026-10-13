#!/usr/bin/env node

const {
    cdpCommand,
    evaluate,
    getCdpConfig,
    getOption,
    getTargets,
    isSpacePageTarget,
    runMain,
    sleep
} = require('./lib/cdp')

function inspectExpression() {
    return `(${function inspectSpaceNukeButton() {
        const cleanText = text => `${text || ''}`.replace(/\s+/g, ' ').trim()
        const button = document.querySelector('.mb-ext_space-feed-nuke-btn')
        const rect = button?.getBoundingClientRect?.()
        let urls = []
        try {
            urls = JSON.parse(button?.dataset?.mbSpaceFeedUrls || '[]')
        }
        catch {}

        return {
            url: location.href,
            title: document.title,
            readyState: document.readyState,
            visibilityState: document.visibilityState,
            button: button ? {
                text: cleanText(button.innerText || button.textContent || ''),
                state: button.dataset?.mbNukeState || '',
                disabled: button.disabled === true,
                visible: !!rect && rect.width > 0 && rect.height > 0,
                urlsCount: urls.length,
                rect: rect ? {
                    x: Math.round(rect.x),
                    y: Math.round(rect.y),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height)
                } : null
            } : null,
            counts: {
                topButtons: document.querySelectorAll('.mb-ext_space-feed-nuke-btn').length,
                postHosts: document.querySelectorAll('.mb-ext_space-feed-post-nuke-host').length,
                postButtons: document.querySelectorAll('.mb-ext_space-feed-post-nuke-btn').length,
                timestamps: document.querySelectorAll('a.post_timestamp').length
            }
        }
    }})()`
}

async function clickSpaceNukeButton(target, useInput = false) {
    const before = await evaluate(target.webSocketDebuggerUrl, inspectExpression(), 15000)
    const button = before.button
    if(!button) return {clicked: false, reason: 'button-not-found', before}
    if(button.disabled) return {clicked: false, reason: 'button-disabled', before}
    if(!button.visible) return {clicked: false, reason: 'button-not-visible', before}

    if(useInput) {
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

    const clicked = await evaluate(target.webSocketDebuggerUrl, `(${function clickButton() {
        const button = document.querySelector('.mb-ext_space-feed-nuke-btn')
        if(!button) return {clicked: false, reason: 'button-not-found'}
        button.scrollIntoView({block: 'center', inline: 'nearest'})
        button.click()
        return {
            clicked: true,
            method: 'dom',
            text: `${button.innerText || button.textContent || ''}`.replace(/\s+/g, ' ').trim(),
            disabled: button.disabled === true
        }
    }})()`, 15000)
    return {...clicked, before}
}

runMain(async () => {
    const config = getCdpConfig()
    const needle = getOption('needle', process.env.MB_SPACE_NEEDLE || '').toLowerCase()
    const action = getOption('action', 'state')
    const useInput = getOption('input', 'false') === 'true'
    const waitMs = Number.parseInt(getOption('wait-ms', '2500'), 10) || 2500
    const targets = await getTargets(config)
    const target = targets.find(candidate =>
        isSpacePageTarget(candidate) &&
        (!needle || `${candidate.url || ''}\n${candidate.title || ''}`.toLowerCase().includes(needle)))

    if(!target) {
        console.log(JSON.stringify({ok: false, reason: 'space-target-not-found', needle}, null, 2))
        process.exitCode = 1
        return
    }

    let click = null
    if(action === 'click') {
        click = await clickSpaceNukeButton(target, useInput)
    }
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
