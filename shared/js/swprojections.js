function hashProjectionShardKey(value = '', bucketCount = 1) {
    const text = `${value || ''}`.trim()
    const buckets = Math.max(1, Number.parseInt(bucketCount, 10) || 1)
    if(!text) return -1

    let hash = 0
    for(let index = 0; index < text.length; index += 1) {
        hash = ((hash * 31) + text.charCodeAt(index)) >>> 0
    }
    return hash % buckets
}

function getProjectionShardKeyByIndex(prefix = '', bucketCount = 1, index = 0) {
    const buckets = Math.max(1, Number.parseInt(bucketCount, 10) || 1)
    const normalized = Math.max(0, Math.min(buckets - 1, Number.parseInt(index, 10) || 0))
    return `${prefix || ''}${normalized.toString(16).padStart(2, '0')}`
}

function getProjectionShardKey(prefix = '', bucketCount = 1, value = '') {
    const index = hashProjectionShardKey(value, bucketCount)
    return index >= 0 ? getProjectionShardKeyByIndex(prefix, bucketCount, index) : ''
}

function makeProjectionShardDefaults(prefix = '', bucketCount = 1, initialValueFactory = () => ({})) {
    const defaults = {}
    const buckets = Math.max(1, Number.parseInt(bucketCount, 10) || 1)
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
