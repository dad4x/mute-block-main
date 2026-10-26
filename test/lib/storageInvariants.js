const {
    normalizeQuoraProfileHref,
    normalizeTabTargetUrl
} = require('../../shared/js/subject')

const COORDINATOR_QUEUE_KEY = 'mbCoordinatorQueue'
const COORDINATOR_RUNS_KEY = 'mbCoordinatorRuns'

const TERMINAL_QUEUE_STATUSES = new Set(['succeeded', 'failed', 'skipped', 'canceled'])
const ACTIVE_QUEUE_STATUSES = new Set(['opening', 'active', 'acting', 'settling'])
const ACTIVE_RESOURCE_FIELDS = [
    'tabId',
    'activeTabId',
    'claimedTabId',
    'actionLease',
    'actionLeaseExpiresAt'
]

function isObjectMap(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value)
}

function asObjectMap(value) {
    return isObjectMap(value) ? value : {}
}

function normalizeString(value) {
    return `${value || ''}`.trim()
}

function normalizeProfileHref(value) {
    return normalizeQuoraProfileHref(value) || ''
}

function normalizeRequestedUrl(value) {
    const normalized = normalizeTabTargetUrl(normalizeString(value))
    if(!normalized) return ''

    try {
        const url = new URL(normalized)
        url.hash = ''
        return url.toString()
    }
    catch {
        return normalized
    }
}

function getAttemptId(value = null) {
    if(!isObjectMap(value)) return ''
    return normalizeString(value.attemptId || value.attempt?.id || '')
}

function getItemStatus(item = null) {
    return normalizeString(item?.status || '')
}

function isTerminalQueueItem(item = null) {
    return TERMINAL_QUEUE_STATUSES.has(getItemStatus(item))
}

function hasActiveFieldValue(value) {
    if(value === null || value === undefined || value === false || value === '') return false
    if(typeof value === 'number') return value !== 0
    if(Array.isArray(value)) return value.length > 0
    if(typeof value === 'object') return Object.keys(value).length > 0

    return true
}

function getStoredProfileUrls(record = {}, key = 'remainingUrls') {
    const source = Array.isArray(record?.[key])
        ? record[key]
        : key === 'remainingUrls'
            ? Array.isArray(record?.allUrls)
                ? record.allUrls
                : Array.isArray(record?.urls)
                    ? record.urls
                    : []
            : []
    const seen = new Set()
    const hrefs = []

    for(const value of source) {
        const href = normalizeProfileHref(value)
        if(!href || seen.has(href)) continue
        seen.add(href)
        hrefs.push(href)
    }

    return hrefs
}

function getQueueItemProfileHrefs(key = '', item = {}) {
    const hrefs = [
        key,
        item.profileHref,
        item.targetProfileHref,
        item.requestedUrl,
        item.canonicalSubject?.href,
        item.subject?.href
    ]
    const normalized = []
    const seen = new Set()

    for(const value of hrefs) {
        const href = normalizeProfileHref(value)
        if(!href || seen.has(href)) continue
        seen.add(href)
        normalized.push(href)
    }

    return normalized
}

function stripProfileResolutionQueueKey(key = '') {
    const value = normalizeString(key)
    return value.startsWith('resolve-profile:') ? value.slice('resolve-profile:'.length) : value
}

function makeProfileResolutionQueueKey(value = '') {
    const requestedUrl = normalizeRequestedUrl(stripProfileResolutionQueueKey(value))
    return requestedUrl ? `resolve-profile:${requestedUrl}` : ''
}

function isProfileResolutionItem(key = '', item = {}) {
    return item?.resolveProfileFromPage === true ||
        normalizeString(item?.resolutionMode) === 'author-profile' ||
        normalizeString(item?.coordinatorKey || item?.dedupeKey || key).startsWith('resolve-profile:')
}

function getResolverRequestedUrl(key = '', item = {}) {
    return normalizeRequestedUrl(
        item.requestedUrl ||
        stripProfileResolutionQueueKey(item.coordinatorKey || item.dedupeKey || key)
    )
}

function buildQueueIndexes(queue = {}) {
    const byKey = new Map()
    const byProfileHref = new Map()
    const resolverByRequestedUrl = new Map()

    for(const [key, item] of Object.entries(asObjectMap(queue))) {
        const entry = {key, item}
        byKey.set(key, entry)

        const normalizedKey = normalizeProfileHref(key)
        if(normalizedKey) byKey.set(normalizedKey, entry)

        for(const href of getQueueItemProfileHrefs(key, item)) {
            if(!byProfileHref.has(href)) byProfileHref.set(href, [])
            byProfileHref.get(href).push(entry)
        }

        if(isProfileResolutionItem(key, item)) {
            const requestedUrl = getResolverRequestedUrl(key, item)
            if(requestedUrl) resolverByRequestedUrl.set(requestedUrl, entry)

            const resolverKey = makeProfileResolutionQueueKey(item.coordinatorKey || item.dedupeKey || key)
            if(resolverKey) byKey.set(resolverKey, entry)
        }
    }

    return {
        byKey,
        byProfileHref,
        resolverByRequestedUrl
    }
}

function addIssue(issues, code, severity, fields = {}) {
    issues.push({
        code,
        severity,
        ...fields
    })
}

function buildNormalizedJobKeysByHref(record = {}) {
    const normalized = {}
    const source = asObjectMap(record.jobKeysByProfileHref)

    for(const [rawHref, rawJobKey] of Object.entries(source)) {
        const href = normalizeProfileHref(rawHref)
        if(!href) continue
        normalized[href] = normalizeString(rawJobKey)
    }

    return normalized
}

function checkQueueInvariants(queue, issues) {
    for(const [key, item] of Object.entries(asObjectMap(queue))) {
        const status = getItemStatus(item)
        const runId = normalizeString(item?.runId || item?.scope?.runId)

        if(TERMINAL_QUEUE_STATUSES.has(status)) {
            for(const field of ACTIVE_RESOURCE_FIELDS) {
                if(!hasActiveFieldValue(item?.[field])) continue
                addIssue(issues, 'terminal-queue-active-field', 'error', {
                    key,
                    runId,
                    status,
                    field,
                    message: `terminal queue row retains ${field}`
                })
            }
        }

        if(ACTIVE_QUEUE_STATUSES.has(status) && !getAttemptId(item)) {
            addIssue(issues, 'active-queue-missing-attempt', 'error', {
                key,
                runId,
                status,
                message: 'active queue row has no attempt identity'
            })
        }
    }
}

function checkRunInvariants(runs, indexes, issues) {
    for(const [runKey, run] of Object.entries(asObjectMap(runs))) {
        const runId = normalizeString(run?.id || runKey)
        const status = normalizeString(run?.status)
        if(TERMINAL_QUEUE_STATUSES.has(status) || status === 'complete' || status === 'completed') continue

        for(const href of getStoredProfileUrls({remainingUrls: run?.targetProfileHrefs || []}, 'remainingUrls')) {
            if(indexes.byProfileHref.has(href)) continue
            addIssue(issues, 'run-target-missing-queue', 'warning', {
                runId,
                href,
                message: 'active run target has no queue row'
            })
        }
    }
}

function checkStorageInvariants(snapshot = {}) {
    const storage = asObjectMap(snapshot)
    const queue = asObjectMap(storage[COORDINATOR_QUEUE_KEY])
    const runs = asObjectMap(storage[COORDINATOR_RUNS_KEY])
    const issues = []
    const indexes = buildQueueIndexes(queue)

    checkQueueInvariants(queue, issues)
    checkRunInvariants(runs, indexes, issues)

    return issues
}

module.exports = {
    COORDINATOR_QUEUE_KEY,
    COORDINATOR_RUNS_KEY,
    checkStorageInvariants
}
