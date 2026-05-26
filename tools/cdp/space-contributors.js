#!/usr/bin/env node

const {
    evaluate,
    getCdpConfig,
    getOption,
    getTargets,
    runMain,
    sleep
} = require('./lib/cdp')

function pageNeedle() {
    return getOption('needle', process.env.MB_SPACE_NEEDLE || 'itsoktobewhite').toLowerCase()
}

function requestedAction() {
    return getOption('action', process.env.MB_CONTRIBUTORS_ACTION || 'inspect')
}

async function findSpacePage(config, needle) {
    const targets = await getTargets(config)
    const pages = targets.filter(target => {
        if(target.type !== 'page') return false
        return `${target.url || ''}\n${target.title || ''}`.toLowerCase().includes(needle)
    })
    pages.sort((left, right) => {
        const leftExact = (left.url || '').toLowerCase().includes(`https://${needle}.quora.com`) ? 1 : 0
        const rightExact = (right.url || '').toLowerCase().includes(`https://${needle}.quora.com`) ? 1 : 0
        return rightExact - leftExact
    })
    return pages[0] || null
}

async function inspectPage(page) {
    return evaluate(page.webSocketDebuggerUrl, `(${function inspectContributors() {
        const text = element => `${element?.innerText || element?.textContent || ''}`.replace(/\s+/g, ' ').trim()
        const visible = element => {
            if(!element) return false
            const rect = element.getBoundingClientRect()
            const style = getComputedStyle(element)
            return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
        }
        const dialogs = Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"], [role="dialog"].modal_content_inner, .modal_content_inner[aria-modal="true"]'))
            .filter(visible)
        const modal = dialogs.find(dialog => /contributor/i.test(text(dialog))) || dialogs[0] || null
        const modalButtons = modal ? Array.from(modal.querySelectorAll('button, [role="button"]')).map(button => ({
            text: text(button),
            className: `${button.className || ''}`,
            aria: button.getAttribute('aria-label') || '',
            disabled: !!button.disabled
        })).filter(button => /nuke|open|dismiss|contributor|profile/i.test(`${button.text} ${button.className} ${button.aria}`)) : []
        const scroller = modal ? [modal, ...Array.from(modal.querySelectorAll('*'))].filter(visible).map(element => ({
            tag: element.tagName,
            className: `${element.className || ''}`.slice(0, 120),
            listItems: element.querySelectorAll?.('[role="listitem"]').length || 0,
            scrollTop: Math.round(element.scrollTop || 0),
            scrollHeight: Math.round(element.scrollHeight || 0),
            clientHeight: Math.round(element.clientHeight || 0)
        })).filter(item => item.scrollHeight > item.clientHeight + 20).sort((left, right) => right.listItems - left.listItems || right.scrollHeight - left.scrollHeight)[0] : null
        const profileHrefs = modal ? Array.from(modal.querySelectorAll('a[href*="/profile/"]'), link => link.href).filter(Boolean) : []
        const uniqueProfileHrefs = Array.from(new Set(profileHrefs))
        return {
            url: location.href,
            title: document.title,
            viewContributorsButton: (() => {
                const button = document.querySelector('.mb-ext_view-contributors-btn, .mb-ext_open-profiles-btn')
                return button ? {
                    text: text(button),
                    className: `${button.className || ''}`,
                    disabled: !!button.disabled
                } : null
            })(),
            modal: modal ? {
                text: text(modal).slice(0, 300),
                listItems: modal.querySelectorAll('[role="listitem"]').length,
                profileLinks: uniqueProfileHrefs.length,
                profileHrefs: uniqueProfileHrefs.slice(0, 20),
                nukeButton: (() => {
                    const button = modal.querySelector('.mb-ext_nuke-profiles-btn')
                    return button ? {
                        text: text(button),
                        disabled: !!button.disabled,
                        state: button.dataset?.mbNukeState || ''
                    } : null
                })(),
                openButton: (() => {
                    const button = modal.querySelector('.mb-ext_open-profiles-btn')
                    return button ? {
                        text: text(button),
                        disabled: !!button.disabled
                    } : null
                })(),
                scroller
            } : null,
            modalButtons
        }
    }})()`)
}

async function clickViewContributors(page) {
    return evaluate(page.webSocketDebuggerUrl, `(${function clickButton() {
        const button = document.querySelector('.mb-ext_view-contributors-btn, .mb-ext_open-profiles-btn')
        if(!button) return {clicked: false, reason: 'missing contributors button'}
        if(button.disabled) return {clicked: false, reason: 'contributors button disabled'}
        button.click()
        return {clicked: true}
    }})()`)
}

async function clickModalNuke(page) {
    return evaluate(page.webSocketDebuggerUrl, `(${function clickButton() {
        const text = element => `${element?.innerText || element?.textContent || ''}`.replace(/\s+/g, ' ').trim()
        const dialogs = Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"], [role="dialog"].modal_content_inner, .modal_content_inner[aria-modal="true"]'))
        const modal = dialogs.find(dialog => /contributor/i.test(text(dialog))) || dialogs[0] || null
        const button = modal?.querySelector('.mb-ext_nuke-profiles-btn') || null
        if(!modal) return {clicked: false, reason: 'missing modal'}
        if(!button) return {clicked: false, reason: 'missing nuke button', modalText: text(modal).slice(0, 300)}
        if(button.disabled) return {clicked: false, reason: 'nuke button disabled', text: text(button), state: button.dataset?.mbNukeState || ''}
        button.click()
        return {clicked: true, text: text(button)}
    }})()`)
}

async function waitFor(page, predicate, timeoutMs = 15000) {
    const start = Date.now()
    let last = null
    while(Date.now() - start < timeoutMs) {
        last = await inspectPage(page)
        if(predicate(last)) return last
        await sleep(500)
    }
    return last
}

runMain(async () => {
    const config = getCdpConfig()
    const needle = pageNeedle()
    const action = requestedAction()
    const page = await findSpacePage(config, needle)
    if(!page) {
        console.log(JSON.stringify({needle, action, found: false}, null, 2))
        process.exitCode = 1
        return
    }

    const output = {
        needle,
        action,
        found: true,
        target: {id: page.id, title: page.title, url: page.url},
        before: await inspectPage(page)
    }

    if(action === 'open' || action === 'open-and-nuke') {
        output.openResult = await clickViewContributors(page)
        output.afterOpen = await waitFor(page, state => !!state.modal, 20000)
    }

    if(action === 'nuke' || action === 'open-and-nuke') {
        if(action === 'nuke') {
            output.beforeNuke = await waitFor(page, state => !!state.modal?.nukeButton, 5000)
        }
        output.nukeResult = await clickModalNuke(page)
        output.afterNuke = await waitFor(page, state => state.modal?.nukeButton?.disabled || !state.modal?.nukeButton, 5000)
    }

    if(action === 'inspect') {
        output.after = output.before
    }
    else {
        output.after = await inspectPage(page)
    }

    console.log(JSON.stringify(output, null, 2))
})
