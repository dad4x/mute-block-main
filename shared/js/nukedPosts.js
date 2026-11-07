// The two nuke-history settings. They govern the completed profile history (the completed log, sw.js and swCompletedShards.js):
// nukedPostRetentionDays is its age limit, maxRememberedNukedPosts its row cap. The space post map that used to be kept under these
// settings was removed (25 Oct): the feed decides per profile, from the completed log and profile progress.
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

module.exports = {
    DEFAULT_MAX_REMEMBERED_NUKED_POSTS,
    DEFAULT_NUKED_POST_RETENTION_DAYS,
    MAX_REMEMBERED_NUKED_POSTS_KEY,
    NUKED_POST_RETENTION_DAYS_KEY,
    normalizeMaxRememberedNukedPosts,
    normalizeRetentionDays
}
