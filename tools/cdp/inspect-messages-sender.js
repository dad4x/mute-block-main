#!/usr/bin/env node

const {evaluate, getCdpConfig, getTargets, runMain} = require('./lib/cdp')

function textSnippet(value = '', limit = 180) {
    const text = `${value || ''}`.replace(/\s+/g, ' ').trim()
    return text.length > limit ? `${text.slice(0, limit)}...` : text
}

runMain(async () => {
    const config = getCdpConfig()
    const targets = await getTargets(config)
    const messagesTarget = targets.find(target =>
        target.type === 'page' &&
        /^https:\/\/www\.quora\.com\/messages(?:[/?#]|$)/i.test(target.url || '')
    )

    if(!messagesTarget) {
        console.log(JSON.stringify({found: false, reason: 'messages-target-not-found'}, null, 2))
        return
    }

    const summary = await evaluate(messagesTarget.webSocketDebuggerUrl, `(() => {
        const isVisible = element => {
            if(!element || !(element instanceof Element)) return false
            const style = getComputedStyle(element)
            if(style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
            const rect = element.getBoundingClientRect()
            return rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.right >= 0 &&
                rect.top <= innerHeight && rect.left <= innerWidth
        }
        const text = element => (element?.innerText || element?.textContent || '').replace(/\\s+/g, ' ').trim()
        const rectOf = element => {
            const rect = element.getBoundingClientRect()
            return {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height)
            }
        }
        const cssPath = element => {
            const parts = []
            let node = element
            while(node && node.nodeType === Node.ELEMENT_NODE && parts.length < 8) {
                let part = node.tagName.toLowerCase()
                if(node.id) {
                    part += '#' + node.id
                    parts.unshift(part)
                    break
                }
                const stableClasses = Array.from(node.classList || [])
                    .filter(name => !/^q-[a-z0-9_-]{6,}$/i.test(name))
                    .slice(0, 3)
                if(stableClasses.length) part += '.' + stableClasses.join('.')
                const parent = node.parentElement
                if(parent) {
                    const sameTag = Array.from(parent.children).filter(child => child.tagName === node.tagName)
                    if(sameTag.length > 1) part += ':nth-of-type(' + (sameTag.indexOf(node) + 1) + ')'
                }
                parts.unshift(part)
                node = parent
            }
            return parts.join(' > ')
        }
        const linkInfo = anchor => ({
            href: anchor.href || anchor.getAttribute('href') || '',
            text: text(anchor),
            rect: rectOf(anchor),
            path: cssPath(anchor),
            aria: anchor.getAttribute('aria-label') || '',
            role: anchor.getAttribute('role') || ''
        })
        const allAnchors = Array.from(document.querySelectorAll('a[href]'))
        const visibleProfileLinks = allAnchors
            .filter(anchor => isVisible(anchor) && /quora\\.com\\/profile\\//i.test(anchor.href || ''))
            .map(linkInfo)
        const visibleUserLinks = allAnchors
            .filter(anchor => isVisible(anchor) && /^https:\\/\\/www\\.quora\\.com\\/(?!messages|notifications|following|profile\\/|topic\\/|search\\b)[^?#/]+/i.test(anchor.href || ''))
            .map(linkInfo)
        const buttons = Array.from(document.querySelectorAll('button, [role="button"]'))
            .filter(isVisible)
            .map(element => ({
                text: text(element),
                aria: element.getAttribute('aria-label') || '',
                rect: rectOf(element),
                path: cssPath(element)
            }))
            .filter(item => item.text || item.aria)
        const conversationCandidates = Array.from(document.querySelectorAll('[role="main"], main, [class*="Message"], [class*="message"], [class*="conversation"], [class*="Conversation"]'))
            .filter(isVisible)
            .map(element => ({
                tag: element.tagName.toLowerCase(),
                text: text(element).slice(0, 500),
                rect: rectOf(element),
                path: cssPath(element)
            }))
            .slice(0, 40)
        const headings = Array.from(document.querySelectorAll('h1,h2,h3,[role="heading"]'))
            .filter(isVisible)
            .map(element => ({
                text: text(element),
                rect: rectOf(element),
                path: cssPath(element)
            }))
        return {
            title: document.title,
            url: location.href,
            viewport: {width: innerWidth, height: innerHeight},
            visibleProfileLinks,
            visibleUserLinks,
            headings,
            buttons,
            conversationCandidates
        }
    })()`)

    const compact = {
        target: {
            id: messagesTarget.id,
            title: messagesTarget.title || '',
            url: messagesTarget.url || ''
        },
        title: summary.title,
        url: summary.url,
        viewport: summary.viewport,
        visibleProfileLinks: (summary.visibleProfileLinks || []).map(item => ({
            ...item,
            text: textSnippet(item.text),
            aria: textSnippet(item.aria)
        })),
        visibleUserLinks: (summary.visibleUserLinks || []).map(item => ({
            ...item,
            text: textSnippet(item.text),
            aria: textSnippet(item.aria)
        })),
        headings: (summary.headings || []).map(item => ({
            ...item,
            text: textSnippet(item.text)
        })),
        buttons: (summary.buttons || []).map(item => ({
            ...item,
            text: textSnippet(item.text),
            aria: textSnippet(item.aria)
        })),
        conversationCandidates: (summary.conversationCandidates || []).map(item => ({
            ...item,
            text: textSnippet(item.text, 260)
        }))
    }

    console.log(JSON.stringify(compact, null, 2))
})
