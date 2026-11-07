// The shard count is required: a caller that leaves it out gets an error, not one shard (24 Oct review, Appendix C.1).
function requireProjectionBucketCount(bucketCount) {
    const buckets = Number.parseInt(bucketCount, 10)
    if(!Number.isFinite(buckets) || buckets < 1) {
        throw new Error(`projection shard helpers need a bucket count of at least 1, got ${bucketCount}`)
    }
    return buckets
}

function hashProjectionShardKey(value = '', bucketCount) {
    const buckets = requireProjectionBucketCount(bucketCount)
    const text = `${value || ''}`.trim()
    if(!text) return -1

    let hash = 0
    for(let index = 0; index < text.length; index += 1) {
        hash = ((hash * 31) + text.charCodeAt(index)) >>> 0
    }
    return hash % buckets
}

function getProjectionShardKeyByIndex(prefix = '', bucketCount, index = 0) {
    const buckets = requireProjectionBucketCount(bucketCount)
    const normalized = Math.max(0, Math.min(buckets - 1, Number.parseInt(index, 10) || 0))
    return `${prefix || ''}${normalized.toString(16).padStart(2, '0')}`
}

function getProjectionShardKey(prefix = '', bucketCount, value = '') {
    const index = hashProjectionShardKey(value, bucketCount)
    return index >= 0 ? getProjectionShardKeyByIndex(prefix, bucketCount, index) : ''
}

function makeProjectionShardDefaults(prefix = '', bucketCount, initialValueFactory = () => ({})) {
    const defaults = {}
    const buckets = requireProjectionBucketCount(bucketCount)
    for(let index = 0; index < buckets; index += 1) {
        defaults[getProjectionShardKeyByIndex(prefix, buckets, index)] =
            typeof initialValueFactory === 'function' ? initialValueFactory(index) : {}
    }
    return defaults
}

module.exports = {
    getProjectionShardKey,
    getProjectionShardKeyByIndex,
    hashProjectionShardKey,
    makeProjectionShardDefaults
}
