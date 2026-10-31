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
    // Owner, 15 Oct: strip no suffix until a live example proves one must go. A suffix such as -share, -followers or -answers
    // is kept as written, so it makes a separate identity. The query and fragment are still dropped. Review 4 (R4-1, R4-3,
    // owner 15 Oct): NFC, not NFKC, so fullwidth lookalikes stay apart, and no trailing separator or whitespace trim, so the
    // slug is kept as written. The helpers below (stripDescriptiveProfileSuffix, stripTrailingProfileArtifactToken) are no
    // longer called; they stay for that day.
    return `${slug || ''}`.normalize('NFC').replace(/[?#].*$/g, '')
}

const DESCRIPTIVE_PROFILE_WORDS = new Set([
    'a', 'about', 'again', 'and', 'asking', 'bio', 'comment', 'comments',
    'details', 'for', 'from', 'he', 'her', 'hers', 'his', 'lets', 'made',
    'my', 'of', 'par', 'peoples', 'question', 'quora', 'see', 'she',
    'some', 'that', 'the', 'their', 'this', 'those', 'try', 'weird'
])

function stripDescriptiveProfileSuffix(value) {
    const tokens = `${value || ''}`.split('-').filter(Boolean)
    if(tokens.length < 2) return `${value || ''}`

    // Exact, as written (owner, 14 Oct): "His" and "Bio" are not the artifact words "his" and "bio".
    const isDescriptiveToken = token => {
        const value = `${token || ''}`
        return DESCRIPTIVE_PROFILE_WORDS.has(value) || /^[a-z]{1,3}$/.test(value)
    }
    const suffixLooksDescriptive = suffixTokens => {
        if(!suffixTokens.length) return false
        // Owner, 14 Oct, "also suffix-cutting": a tail is removed only when every token in it is an artifact word, so one
        // lower-case word cannot take a case-shifted token with it (Cesc-Fabregas-56-SHARE-x keeps SHARE).
        if(suffixTokens.length >= 2) return suffixTokens.every(isDescriptiveToken)

        return ['bio', 'details', 'quora'].includes(`${suffixTokens[0] || ''}`)
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

    // Exact, as written (owner, 14 Oct): only the lower-case artifact tokens below are removed.
    const lastToken = `${tokens[tokens.length - 1] || ''}`
    const previousToken = `${tokens[tokens.length - 2] || ''}`

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

function isLikelyExplicitProfileTargetSlug(slug) {
    const value = sanitizeProfileHrefSlug(slug)
    if(!value) return false

    const tokens = value.split('-').filter(Boolean)
    if(tokens.length < 2) return false

    const proseTokens = new Set([
        'about', 'again', 'answer', 'answers', 'because', 'checking',
        'comment', 'comments', 'does', 'freely', 'from', 'have', 'hes',
        'into', 'made', 'much', 'post', 'question', 'saves', 'says', 'she',
        'states', 'that', 'their', 'this', 'time', 'troll', 'what', 'when',
        'where', 'with', 'without'
    ])
    const isNameishToken = token => /^[A-Z][A-Za-z0-9]*$/.test(token) ||
        /^[A-Z0-9]{2,}$/.test(token) ||
        /^\d+$/.test(token)
    const proseCount = tokens.filter(token => proseTokens.has(`${token || ''}`.toLowerCase())).length
    if(proseCount >= 2) return false

    const nonNameishCount = tokens.filter(token => !isNameishToken(token)).length
    if(tokens.length > 4 && nonNameishCount >= 2) return false
    if(tokens.length > 6 && !tokens.some(token => /^\d+$/.test(token))) return false
    if(tokens.length > 8) return false

    return true
}

function isLikelyExplicitProfileTargetHref(href) {
    const normalizedHref = normalizeQuoraProfileHref(href)
    if(!normalizedHref) return false

    try {
        const url = new URL(normalizedHref)
        const slug = decodeURIComponent(url.pathname.replace(/^\/profile\//i, ''))
        return isLikelyExplicitProfileTargetSlug(slug)
    }
    catch {
        return false
    }
}

function isLikelyDirectProfileSlug(slug) {
    const value = `${slug || ''}`.trim()
    if(!value) return false
    if(/[\/\\?#]/.test(value)) return false

    const tokens = value.split('-').filter(Boolean)
    if(tokens.length < 2) return false
    if(tokens.length > 8) return false

    const isNameishToken = token => /^[A-Z][A-Za-z0-9]*$/.test(token) || /^[A-Z0-9]{2,}$/.test(token)

    // 30 Oct: a question that starts with a question word and has a plain lowercase word ("What-made-the-2707-so-superior") is a question, even
    // with a number in it. Without this, the number rule below made it a profile, so the question page got profile buttons. A profile with a
    // question-word first name and a number ("Will-Fridolf-5") has no lowercase word, so it still passes.
    if(/^(?:a|an|are|can|could|did|do|does|how|is|should|the|what|when|where|who|why|will|would)$/i.test(tokens[0] || '') &&
        tokens.some(token => /^[a-z]+$/.test(token))) {
        return false
    }

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

// Owner, 24 Oct: the same profile address is normalised on every render. Results are remembered (bounded), since the function is pure for a given base.
const normalizedProfileHrefMemo = new Map()
const NORMALIZED_PROFILE_HREF_MEMO_LIMIT = 4000

function normalizeQuoraProfileHref(href, baseUrl = getDefaultBaseUrl()) {
    if(!href) return null

    const key = `${href}\n${baseUrl}`
    if(normalizedProfileHrefMemo.has(key)) return normalizedProfileHrefMemo.get(key)

    const value = normalizeQuoraProfileHrefUncached(href, baseUrl)
    if(normalizedProfileHrefMemo.size >= NORMALIZED_PROFILE_HREF_MEMO_LIMIT) normalizedProfileHrefMemo.clear()
    normalizedProfileHrefMemo.set(key, value)
    return value
}

function normalizeQuoraProfileHrefUncached(href, baseUrl = getDefaultBaseUrl()) {
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

        return `https://www.quora.com/profile/${encodeURIComponent(stripProfileClosedSetTail(decodedSlug))}`
    }
    catch {
        return null
    }
}

// The closed set of tails Quora links add to a profile slug (historical/suffix-cutting-discussion-2026-10-14.md). Name-log is the
// profile Name, not a profile of its own. Only one tail is removed, and the name keeps what is before it.
const PROFILE_CLOSED_SET_TAIL = /^(.+?)-(?:log|answers|questions|posts|share-\d+|ch-\d+)$/

function stripProfileClosedSetTail(slug = '') {
    const match = PROFILE_CLOSED_SET_TAIL.exec(slug)
    return match ? match[1] : slug
}

function normalizeTabTargetUrl(url) {
    return normalizeQuoraProfileHref(url) || url
}

// Shadow measurement only (owner, 15 Oct). The suffix rule as it stood at HEAD was case-insensitive. This returns what that
// rule would have removed from a slug, so a live run can count it. The result is never stored, and no key uses it.
// Folding to lower case is exact here: every cut pattern is lower-case, and the tail helpers compare lower-case tokens.
const LEGACY_SHADOW_CUT_PATTERNS = [
    /-amp-(?:ch|oid|share|srid|target|targ|target-type|type)/,
    /-(?:ch|oid|share|srid|target|target_type|type)-/,
    /-(?:followers?|following|log)-/,
    /-https?$/,
    /-https?-/,
    /-(?:followers?|following|log)$/
]

const SHADOW_SUFFIX_TOKENS = new Set([
    'amp', 'ch', 'oid', 'share', 'srid', 'target', 'targ', 'type', 'target_type', 'followers', 'follower', 'following',
    'log', 'http', 'https', 'answers', 'posts', 'questions', 'bio', 'details', 'quora'
])

// The descriptive tail rule as it stood at HEAD: one descriptive token anywhere in the tail was enough. Measurement only.
function legacyDescriptiveTailCut(value) {
    const tokens = `${value || ''}`.split('-').filter(Boolean)
    if(tokens.length < 2) return `${value || ''}`

    const isDescriptive = token => DESCRIPTIVE_PROFILE_WORDS.has(token) || /^[a-z]{1,3}$/.test(token)
    const looksDescriptive = suffixTokens => {
        if(!suffixTokens.length) return false
        if(suffixTokens.length >= 2 && suffixTokens.some(isDescriptive)) return true

        return ['bio', 'details', 'quora'].includes(`${suffixTokens[0] || ''}`)
    }

    let anchorIndex = tokens.findIndex((token, index) => index > 0 && /^\d+$/.test(token))
    if(anchorIndex >= 0 && looksDescriptive(tokens.slice(anchorIndex + 1))) {
        return tokens.slice(0, anchorIndex + 1).join('-')
    }

    anchorIndex = tokens.findIndex((token, index) => /\d+$/.test(token) && index < tokens.length - 1)
    if(anchorIndex >= 0 && looksDescriptive(tokens.slice(anchorIndex + 1))) {
        return tokens.slice(0, anchorIndex + 1).join('-')
    }

    return `${value || ''}`
}

// NFKC on purpose: this replicates HEAD's sanitizer for the shadow counter, so it does not follow the NFC identity change.
function legacyStrippedSuffix(slug = '') {
    const value = `${slug || ''}`.normalize('NFKC').replace(/[?#].*$/g, '').trim()
    const folded = value.toLowerCase()
    if(folded.length !== value.length) return ''

    let cutIndex = -1
    for(const pattern of LEGACY_SHADOW_CUT_PATTERNS) {
        const match = pattern.exec(folded)
        if(match && (cutIndex === -1 || match.index < cutIndex)) {
            cutIndex = match.index
        }
    }

    let kept = cutIndex >= 0 ? folded.slice(0, cutIndex) : folded
    kept = legacyDescriptiveTailCut(kept)
    kept = stripTrailingProfileArtifactToken(kept)
    const removed = value.slice(kept.length)
    return /[a-z0-9]/i.test(removed) ? removed : ''
}

// The known suffix tokens inside a removed suffix. A removed suffix with none of them counts as 'other'.
function shadowSuffixTokens(removed = '') {
    const tokens = `${removed || ''}`.toLowerCase().split('-').filter(Boolean)
    if(!tokens.length) return []

    const known = [...new Set(tokens.filter(token => SHADOW_SUFFIX_TOKENS.has(token)))]
    return known.length ? known : ['other']
}

module.exports = {
    QUORA_NON_PROFILE_ROOT_PATHS,
    getLikelyQuoraProfileSlug,
    isLikelyExplicitProfileTargetHref,
    isLikelyExplicitProfileTargetSlug,
    isLikelyDirectProfileSlug,
    normalizeQuoraProfileHref,
    normalizeTabTargetUrl,
    sanitizeProfileHrefSlug,
    stripDescriptiveProfileSuffix,
    stripTrailingProfileArtifactToken,
    legacyStrippedSuffix,
    shadowSuffixTokens
}
