const SPACE_NUKED_POSTS_KEY = 'mbSpaceNukedPosts'
const NUKED_POST_RETENTION_DAYS_KEY = 'nukedPostRetentionDays'
const MAX_REMEMBERED_NUKED_POSTS_KEY = 'maxRememberedNukedPosts'
const DEFAULT_NUKED_POST_RETENTION_DAYS = 30
const DEFAULT_MAX_REMEMBERED_NUKED_POSTS = 10000

function normalizeRetentionDays(value, fallback = DEFAULT_NUKED_POST_RETENTION_DAYS) {
    const parsed = Number.parseInt(value, 10)
    if(!Number.isFinite(parsed) || parsed < 0) return fallback
    return parsed
}

function normalizeMaxRememberedNukedPosts(value, fallback = DEFAULT_MAX_REMEMBERED_NUKED_POSTS) {
    const parsed = Number.parseInt(value, 10)
    if(!Number.isFinite(parsed) || parsed < 0) return fallback
    return parsed
}

function getPrunedNukedPosts(records, options = {}) {
    const source = records && typeof records === 'object' ? records : {}
    const retentionDays = normalizeRetentionDays(options.retentionDays, DEFAULT_NUKED_POST_RETENTION_DAYS)
    const maxEntries = normalizeMaxRememberedNukedPosts(options.maxEntries, DEFAULT_MAX_REMEMBERED_NUKED_POSTS)
    const now = Number.isFinite(options.now) ? options.now : Date.now()

    let entries = Object.entries(source)
        .filter(([postKey, record]) => !!postKey && record && typeof record === 'object')
        .map(([postKey, record]) => {
            const updatedAt = Number.isFinite(record.updatedAt) ? record.updatedAt : 0
            return [postKey, {...record, updatedAt}]
        })

    if(retentionDays > 0) {
        const cutoff = now - retentionDays * 24 * 60 * 60 * 1000
        entries = entries.filter(([, record]) => record.updatedAt >= cutoff)
    }

    entries.sort((left, right) => right[1].updatedAt - left[1].updatedAt || left[0].localeCompare(right[0]))

    if(maxEntries > 0 && entries.length > maxEntries) {
        entries = entries.slice(0, maxEntries)
    }

    return Object.fromEntries(entries)
}

function haveSameNukedPostKeys(left, right) {
    const leftKeys = Object.keys(left || {}).sort()
    const rightKeys = Object.keys(right || {}).sort()
    if(leftKeys.length !== rightKeys.length) return false
    return leftKeys.every((key, index) => key === rightKeys[index])
}

module.exports = {
    DEFAULT_MAX_REMEMBERED_NUKED_POSTS,
    DEFAULT_NUKED_POST_RETENTION_DAYS,
    MAX_REMEMBERED_NUKED_POSTS_KEY,
    NUKED_POST_RETENTION_DAYS_KEY,
    SPACE_NUKED_POSTS_KEY,
    getPrunedNukedPosts,
    haveSameNukedPostKeys,
    normalizeMaxRememberedNukedPosts,
    normalizeRetentionDays
}
