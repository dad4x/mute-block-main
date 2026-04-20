const SPACE_REGISTRY_KEY = 'mbSpaceRegistry'
const SPACE_SORT_KEY = 'mbSpaceSortBy'
const SPACE_SORT_NAME = 'name'
const SPACE_SORT_CATEGORY = 'category'
const SPACE_CATEGORY_ASSET = 'asset'
const SPACE_CATEGORY_NEUTRAL = 'neutral'
const SPACE_CATEGORY_TARGET = 'target'
const SPACE_CATEGORIES = [SPACE_CATEGORY_ASSET, SPACE_CATEGORY_NEUTRAL, SPACE_CATEGORY_TARGET]
const SPACE_CATEGORY_ORDER = {
    [SPACE_CATEGORY_ASSET]: 0,
    [SPACE_CATEGORY_NEUTRAL]: 1,
    [SPACE_CATEGORY_TARGET]: 2
}

function normalizeSpaceCategory(category) {
    return SPACE_CATEGORIES.includes(category) ? category : ''
}

function getSpaceCategoryShortLabel(category) {
    if(category === SPACE_CATEGORY_ASSET) return 'Asset'
    if(category === SPACE_CATEGORY_NEUTRAL) return 'Neutral'
    if(category === SPACE_CATEGORY_TARGET) return 'Target'
    return 'Unknown'
}

function getSpaceCategoryLongLabel(category) {
    if(category === SPACE_CATEGORY_ASSET) return 'Asset'
    if(category === SPACE_CATEGORY_NEUTRAL) return 'Neutral'
    if(category === SPACE_CATEGORY_TARGET) return 'Target'
    return 'Unknown'
}

function normalizeSpaceUrl(url) {
    try {
        const parsed = new URL(url)
        parsed.search = ''
        parsed.hash = ''

        let pathname = parsed.pathname.replace(/\/+$/, '')
        if(!pathname) pathname = '/'

        if(parsed.hostname !== 'www.quora.com' && pathname === '/') {
            return `${parsed.protocol}//${parsed.hostname}`
        }

        return `${parsed.protocol}//${parsed.hostname}${pathname}`
    }
    catch {
        return ''
    }
}

function getDocumentCanonicalUrl(doc = document) {
    const ogUrl = doc.querySelector('meta[property="og:url"]')?.content?.trim()
    if(ogUrl) return ogUrl

    const canonical = doc.querySelector('link[rel="canonical"]')?.href?.trim()
    if(canonical) return canonical

    return doc.location?.href || ''
}

function getSpaceName(doc = document, header = null) {
    const heading = (header || doc).querySelector?.('h1, [role="heading"]')
    const headingText = normalizeLabel(heading?.textContent || '')
    if(headingText) return headingText

    const ogTitle = normalizeLabel(doc.querySelector('meta[property="og:title"]')?.content || '')
    if(ogTitle) return ogTitle.replace(/\s+[|:-]\s+Quora.*$/i, '')

    return normalizeLabel(doc.title || '').replace(/\s+[|:-]\s+Quora.*$/i, '')
}

function extractSpaceSlug(url) {
    try {
        const parsed = new URL(url)

        if(parsed.hostname !== 'www.quora.com') {
            return parsed.hostname.replace(/\.quora\.com$/i, '')
        }

        const parts = parsed.pathname.split('/').filter(Boolean)
        return parts[parts.length - 1] || parsed.hostname
    }
    catch {
        return ''
    }
}

function buildSpaceRecord(space, category, existingRecord = null) {
    const nextCategory = normalizeSpaceCategory(category)
    if(!nextCategory) return null

    const key = `${space?.key || existingRecord?.key || ''}`.trim()
    if(!key) return null

    const url = normalizeSpaceUrl(space?.url || existingRecord?.url || '')
    if(!url) return null

    return {
        key,
        url,
        slug: `${space?.slug || existingRecord?.slug || extractSpaceSlug(url)}`.trim(),
        name: normalizeLabel(space?.name || existingRecord?.name || extractSpaceSlug(url) || url),
        category: nextCategory,
        updatedAt: Date.now()
    }
}

function sortSpaceRecords(records, sortBy = SPACE_SORT_NAME) {
    const list = Array.isArray(records) ? records.slice() : []

    list.sort((left, right) => {
        if(sortBy === SPACE_SORT_CATEGORY) {
            const categoryDelta = (SPACE_CATEGORY_ORDER[left.category] ?? 99) - (SPACE_CATEGORY_ORDER[right.category] ?? 99)
            if(categoryDelta) return categoryDelta
        }

        const nameDelta = (left.name || '').localeCompare(right.name || '', undefined, {sensitivity: 'base'})
        if(nameDelta) return nameDelta

        return (left.slug || '').localeCompare(right.slug || '', undefined, {sensitivity: 'base'})
    })

    return list
}

function normalizeLabel(value) {
    return `${value || ''}`.replace(/\s+/g, ' ').trim()
}

module.exports = {
    SPACE_CATEGORY_ASSET,
    SPACE_CATEGORY_NEUTRAL,
    SPACE_CATEGORY_ORDER,
    SPACE_CATEGORY_TARGET,
    SPACE_CATEGORIES,
    SPACE_REGISTRY_KEY,
    SPACE_SORT_CATEGORY,
    SPACE_SORT_KEY,
    SPACE_SORT_NAME,
    buildSpaceRecord,
    extractSpaceSlug,
    getDocumentCanonicalUrl,
    getSpaceCategoryLongLabel,
    getSpaceCategoryShortLabel,
    getSpaceName,
    normalizeSpaceCategory,
    normalizeSpaceUrl,
    sortSpaceRecords
}
