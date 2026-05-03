const QUORA_NON_PROFILE_ROOT_PATHS = new Set([
    'answer',
    'bookmarks',
    'business',
    'careers',
    'contact',
    'following',
    'messages',
    'notifications',
    'profile',
    'question',
    'search',
    'settings',
    'space',
    'spaces',
    'topic',
    'unanswered'
])

function sanitizeProfileHrefSlug(slug) {
    let value = `${slug || ''}`.normalize('NFKC').replace(/[?#].*$/g, '').trim()
    if(!value) return ''

    const cutPatterns = [
        /-amp-(?:ch|oid|share|srid|target|targ|target-type|type)/i,
        /-(?:ch|oid|share|srid|target|target_type|type)-/i,
        /-(?:followers?|following|log)-/i,
        /-https?$/i,
        /-https?-/i,
        /-(?:followers?|following|log)$/i
    ]

    let cutIndex = -1
    for(const pattern of cutPatterns) {
        const match = pattern.exec(value)
        if(!match) continue
        if(cutIndex === -1 || match.index < cutIndex) {
            cutIndex = match.index
        }
    }

    if(cutIndex >= 0) {
        value = value.slice(0, cutIndex)
    }

    value = stripDescriptiveProfileSuffix(value)
    value = stripTrailingProfileArtifactToken(value)
    return value.replace(/[-_\s]+$/g, '').trim()
}

function stripDescriptiveProfileSuffix(value) {
    const tokens = `${value || ''}`.split('-').filter(Boolean)
    if(tokens.length < 2) return `${value || ''}`

    const descriptiveWords = new Set([
        'a', 'about', 'again', 'and', 'asking', 'bio', 'comment', 'comments',
        'details', 'for', 'from', 'he', 'her', 'hers', 'his', 'lets', 'made',
        'my', 'of', 'par', 'peoples', 'question', 'quora', 'see', 'she',
        'some', 'that', 'the', 'their', 'this', 'those', 'try', 'weird'
    ])
    const isDescriptiveToken = token => {
        const normalized = `${token || ''}`.toLowerCase()
        return descriptiveWords.has(normalized) || /^[a-z]{1,3}$/.test(normalized)
    }
    const suffixLooksDescriptive = suffixTokens => {
        if(!suffixTokens.length) return false
        if(suffixTokens.length >= 2 && suffixTokens.some(isDescriptiveToken)) return true

        const first = `${suffixTokens[0] || ''}`.toLowerCase()
        return ['bio', 'details', 'quora'].includes(first)
    }

    let anchorIndex = tokens.findIndex((token, index) => index > 0 && /^\d+$/.test(token))
    if(anchorIndex >= 0 && suffixLooksDescriptive(tokens.slice(anchorIndex + 1))) {
        return tokens.slice(0, anchorIndex + 1).join('-')
    }

    anchorIndex = tokens.findIndex((token, index) => /\d+$/.test(token) && index < tokens.length - 1)
    if(anchorIndex >= 0 && suffixLooksDescriptive(tokens.slice(anchorIndex + 1))) {
        return tokens.slice(0, anchorIndex + 1).join('-')
    }

    return `${value || ''}`
}

function stripTrailingProfileArtifactToken(value) {
    const tokens = `${value || ''}`.split('-').filter(Boolean)
    if(tokens.length < 2) return `${value || ''}`

    const lastToken = `${tokens[tokens.length - 1] || ''}`.toLowerCase()
    const previousToken = `${tokens[tokens.length - 2] || ''}`.toLowerCase()

    if(lastToken === 'ch') {
        if(!/^\d+$/.test(previousToken)) return `${value || ''}`
        tokens.pop()
        return tokens.join('-')
    }

    if(['oid', 'share', 'srid', 'target', 'target_type', 'type'].includes(lastToken)) {
        tokens.pop()
        return tokens.join('-')
    }

    if(['answers', 'posts', 'questions'].includes(lastToken) && tokens.length >= 3) {
        tokens.pop()
        return tokens.join('-')
    }

    return `${value || ''}`
}

function isLikelyDirectProfileSlug(slug) {
    const value = `${slug || ''}`.trim()
    if(!value) return false
    if(/[\/\\?#]/.test(value)) return false

    const tokens = value.split('-').filter(Boolean)
    if(tokens.length < 2) return false

    const isNameishToken = token => /^[A-Z][A-Za-z0-9]*$/.test(token) || /^[A-Z0-9]{2,}$/.test(token)

    if(tokens.some(token => /^\d+$/.test(token))) return true
    if(tokens.some(token => /^[A-F0-9]{2}$/i.test(token))) return true

    if(/^(?:a|an|are|can|could|did|do|does|how|is|should|the|what|when|where|who|why|will|would)$/i.test(tokens[0] || '')) {
        if(/^the$/i.test(tokens[0]) && tokens.length >= 3 && tokens.every(isNameishToken)) {
            return true
        }

        return false
    }

    let nameishTokenCount = 0
    for(const token of tokens) {
        if(isNameishToken(token)) {
            nameishTokenCount += 1
        }
    }

    return nameishTokenCount >= 2
}

function getLikelyQuoraProfileSlug(pathname) {
    const parts = `${pathname || ''}`.split('/').filter(Boolean)
    if(!parts.length) return ''

    const firstPart = `${parts[0] || ''}`
    if(firstPart.toLowerCase() === 'profile') {
        return parts.length >= 2 ? `${parts[1] || ''}` : ''
    }

    if(parts.length !== 1 || QUORA_NON_PROFILE_ROOT_PATHS.has(firstPart.toLowerCase())) return ''
    if(!/-/.test(firstPart)) return ''

    const decodedSlug = sanitizeProfileHrefSlug(decodeURIComponent(firstPart))
    if(!decodedSlug) return ''
    if(!isLikelyDirectProfileSlug(decodedSlug)) return ''

    return firstPart
}

function getDefaultBaseUrl() {
    return globalThis.location?.origin || 'https://www.quora.com'
}

function normalizeQuoraProfileHref(href, baseUrl = getDefaultBaseUrl()) {
    if(!href) return null

    try {
        const url = new URL(href, baseUrl)
        const hostname = `${url.hostname || ''}`.toLowerCase()
        const isPrimaryQuoraHost = hostname === 'quora.com' || hostname === 'www.quora.com'
        const isQuoraSubdomain = hostname.endsWith('.quora.com')
        if(hostname && !isPrimaryQuoraHost && !isQuoraSubdomain) {
            return null
        }

        url.search = ''
        url.hash = ''
        const pathParts = url.pathname.split('/').filter(Boolean)
        if(isQuoraSubdomain && !isPrimaryQuoraHost && pathParts[0]?.toLowerCase() !== 'profile') {
            return null
        }

        const slug = getLikelyQuoraProfileSlug(url.pathname)
        if(!slug) return null

        const decodedSlug = sanitizeProfileHrefSlug(decodeURIComponent(slug))
        if(!decodedSlug) return null
        if(/[\/\\?#]/.test(decodedSlug)) return null
        if(/[\u0000-\u001F\u007F]/.test(decodedSlug)) return null

        return `https://www.quora.com/profile/${encodeURIComponent(decodedSlug)}`
    }
    catch {
        return null
    }
}

function normalizeTabTargetUrl(url) {
    return normalizeQuoraProfileHref(url) || url
}

module.exports = {
    QUORA_NON_PROFILE_ROOT_PATHS,
    getLikelyQuoraProfileSlug,
    isLikelyDirectProfileSlug,
    normalizeQuoraProfileHref,
    normalizeTabTargetUrl,
    sanitizeProfileHrefSlug,
    stripDescriptiveProfileSuffix,
    stripTrailingProfileArtifactToken
}
