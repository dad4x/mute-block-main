const {SPACE_SORT_KEY} = require('./storageKeys')
const {SPACE_REGISTRY_KEY} = require('./storageKeys')
const {PROFILE_SEARCH_COLLECT_LIMIT, PROFILE_SEARCH_COLLECT_CHOICES} = require('./tunables')
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

// The space's Collect N More count, kept on its registry record. Only a count the dropdown offers is kept; anything else is the default.
function normalizeSpaceCollectCount(count) {
    return PROFILE_SEARCH_COLLECT_CHOICES.includes(count) ? count : PROFILE_SEARCH_COLLECT_LIMIT
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
        if(parsed.protocol !== 'https:') return ''
        parsed.search = ''
        parsed.hash = ''

        if(parsed.hostname !== 'www.quora.com' && parsed.hostname.endsWith('.quora.com')) {
            return `${parsed.protocol}//${parsed.hostname}`
        }

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
        collectCount: normalizeSpaceCollectCount(existingRecord?.collectCount),
        updatedAt: Date.now()
    }
}

// The record with a new collect count, or null when the space has no record (an uncategorised space has none, so its count stays in memory).
function withSpaceRecordCollectCount(record, count) {
    if(!record || typeof record !== 'object') return null

    return {
        ...record,
        collectCount: normalizeSpaceCollectCount(count),
        updatedAt: Date.now()
    }
}

// One write to one space's record, applied to the record the worker holds now (29 Oct). The change is a category, with the space's identity
// fields, or a collect count. `at` is when the user acted, and it becomes the record's updatedAt, so the order of writes is the order of
// the user's actions (not the order the worker happened to apply them). A change made before the record's last update is stale: it
// returns null, and the stored record stays. A change with no record to apply it to returns null too.
function applySpaceRecordChange(existingRecord, key, change, at) {
    const actedAt = Number(at) || 0
    if(existingRecord && actedAt < (Number(existingRecord.updatedAt) || 0)) return null
    if(!change || typeof change !== 'object') return null

    let next = null
    if(change.category !== undefined) {
        next = buildSpaceRecord({key, url: change.url, slug: change.slug, name: change.name}, change.category, existingRecord)
    }
    else if(change.collectCount !== undefined) {
        next = withSpaceRecordCollectCount(existingRecord, change.collectCount)
    }
    if(!next) return null
    return actedAt ? {...next, updatedAt: actedAt} : next
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
    applySpaceRecordChange,
    buildSpaceRecord,
    extractSpaceSlug,
    getDocumentCanonicalUrl,
    getSpaceCategoryLongLabel,
    getSpaceCategoryShortLabel,
    getSpaceName,
    normalizeSpaceCategory,
    normalizeSpaceCollectCount,
    normalizeSpaceUrl,
    sortSpaceRecords,
    withSpaceRecordCollectCount
}
