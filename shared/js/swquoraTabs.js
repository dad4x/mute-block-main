const {
    normalizeQuoraProfileHref: normalizeQuoraProfileUrl
} = require('./subject')

function isQuoraRuntimeUrl(value = '') {
    try {
        const url = new URL(`${value || ''}`)
        return /\.quora\.com$/i.test(url.hostname) || /^quora\.com$/i.test(url.hostname)
    }
    catch {
        return false
    }
}

function isQuoraHttpUrl(value = '') {
    try {
        const parsed = new URL(`${value || ''}`)
        const hostname = `${parsed.hostname || ''}`.toLowerCase()
        return (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
            (hostname === 'quora.com' || hostname === 'www.quora.com' || hostname.endsWith('.quora.com'))
    }
    catch {
        return false
    }
}

function isQuoraChallengeLikeUrl(value = '') {
    const text = `${value || ''}`
    return isQuoraHttpUrl(text) &&
        /security|verification|verify|challenge|challenge-platform|cdn-cgi|turnstile/i.test(text)
}

function isNonProfileQuoraHttpLandingUrl(value = '') {
    const text = `${value || ''}`.trim()
    return isQuoraHttpUrl(text) &&
        !normalizeQuoraProfileUrl(text) &&
        !isQuoraChallengeLikeUrl(text)
}

function getNonProfileQuoraLandingMessage(value = '') {
    const text = `${value || ''}`.trim()
    try {
        const url = new URL(text)
        const pageType = `${url.pathname.split('/').filter(Boolean)[0] || 'root'}`.trim() || 'root'
        return `Queued tab did not land on a profile page (${pageType}: ${url.pathname || '/'})`
    }
    catch {
        return `Queued tab did not land on a profile page (${text || 'unknown URL'})`
    }
}

function buildLiveProfileTabsByHref(tabs = []) {
    const tabsByHref = new Map()
    for(const tab of tabs || []) {
        const href = normalizeQuoraProfileUrl(tab?.url || '')
        if(!href) continue

        tabsByHref.set(href, [
            ...(tabsByHref.get(href) || []),
            tab
        ])
    }
    return tabsByHref
}

function getLiveTabsForProfileHref(liveProfileTabsByHref = new Map(), href = '') {
    const normalizedHref = normalizeQuoraProfileUrl(href || '')
    return normalizedHref ? liveProfileTabsByHref.get(normalizedHref) || [] : []
}

module.exports = {
    buildLiveProfileTabsByHref,
    getLiveTabsForProfileHref,
    getNonProfileQuoraLandingMessage,
    isNonProfileQuoraHttpLandingUrl,
    isQuoraChallengeLikeUrl,
    isQuoraHttpUrl,
    isQuoraRuntimeUrl
}
