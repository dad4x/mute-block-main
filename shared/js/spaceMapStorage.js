// Storage layout for the two space-feed post maps (remembered nuked posts and pending records). Both maps are
// held in memory whole, as before. On disk each map is split into 32 bucket keys by a hash of its post key, the
// same shape as the profile progress shards. A write rewrites only the buckets whose content changed, so one
// settlement no longer rewrites the whole map. The layout marker says which layout the disk holds: when it is
// absent, the legacy whole-map keys are the truth (and are never written again); when it is present, the buckets
// are. The legacy keys are kept after migration (unified-store-design.md, A23a), so a rollback reads them.
// Pure functions: no storage access here.

const {hashState} = require('./walSnapshotStore')

const SPACE_MAP_BUCKET_COUNT = 32
const SPACE_MAP_LAYOUT_KEY = 'mbSpaceMapLayoutVersion'
const SPACE_MAP_LAYOUT_BUCKETED = 2

function spaceMapBucketKey(baseKey = '', index = 0) {
    return `${baseKey}.b${Number(index).toString(16).padStart(2, '0')}`
}

function spaceMapBucketIndex(postKey = '') {
    return Number.parseInt(hashState({postKey: `${postKey}`}), 16) % SPACE_MAP_BUCKET_COUNT
}

function spaceMapBucketKeys(baseKey = '') {
    return Array.from({length: SPACE_MAP_BUCKET_COUNT}, (_, index) => spaceMapBucketKey(baseKey, index))
}

// Every bucket key of every map, the layout marker and the legacy keys: the set a reader fetches to find the map.
function spaceMapStorageKeys(baseKeys = []) {
    const keys = [SPACE_MAP_LAYOUT_KEY]
    for(const baseKey of baseKeys) keys.push(baseKey, ...spaceMapBucketKeys(baseKey))
    return keys
}

// Splits one map into its 32 bucket values. Every bucket is present, empty buckets as {}, so a write can
// clear a bucket that held the last entry of a removed post.
function splitSpaceMapIntoBuckets(baseKey = '', map = {}) {
    const buckets = {}
    for(let index = 0; index < SPACE_MAP_BUCKET_COUNT; index += 1) buckets[spaceMapBucketKey(baseKey, index)] = {}
    for(const postKey of Object.keys(map || {})) {
        buckets[spaceMapBucketKey(baseKey, spaceMapBucketIndex(postKey))][postKey] = map[postKey]
    }
    return buckets
}

// The map a reader sees, from a storage read of spaceMapStorageKeys(). Bucketed layout: the buckets merged.
// Legacy layout: the whole-map key, or {} when it is absent.
function readSpaceMapFromStored(stored = {}, baseKey = '') {
    if(stored?.[SPACE_MAP_LAYOUT_KEY] === SPACE_MAP_LAYOUT_BUCKETED) {
        const merged = {}
        for(const bucketKey of spaceMapBucketKeys(baseKey)) {
            const bucket = stored?.[bucketKey]
            if(!bucket || typeof bucket !== 'object') continue
            Object.assign(merged, bucket)
        }
        return merged
    }
    const legacy = stored?.[baseKey]
    return legacy && typeof legacy === 'object' && !Array.isArray(legacy) ? legacy : {}
}

// Hash of each bucket's content, so a writer can tell which buckets changed since the last write.
function hashSpaceMapBuckets(buckets = {}) {
    const hashes = {}
    for(const bucketKey of Object.keys(buckets)) hashes[bucketKey] = hashState(buckets[bucketKey] || {})
    return hashes
}

// The buckets of one map that differ from the hashes last written (or loaded). With no hashes (a legacy disk,
// or before the first load) every bucket counts as changed, which is how the migration writes all of them.
function changedSpaceMapBuckets(baseKey = '', map = {}, previousHashes = null) {
    const buckets = splitSpaceMapIntoBuckets(baseKey, map)
    const hashes = hashSpaceMapBuckets(buckets)
    const changed = {}
    for(const bucketKey of Object.keys(buckets)) {
        if(!previousHashes || previousHashes[bucketKey] !== hashes[bucketKey]) changed[bucketKey] = buckets[bucketKey]
    }
    return {changed, hashes}
}

// Read defaults for a storage get of every layout key of the given maps (null for each, so an absent key reads as absent).
function spaceMapStorageReadDefaults(baseKeys = []) {
    return Object.fromEntries(spaceMapStorageKeys(baseKeys).map(key => [key, null]))
}

// True for the legacy key, a bucket key or the layout marker of one of the given maps. A change event for any of these
// means the map may have changed, so a reader re-reads the whole map.
function isSpaceMapStorageKey(key = '', baseKeys = []) {
    if(key === SPACE_MAP_LAYOUT_KEY) return true
    return baseKeys.some(baseKey => key === baseKey || key.startsWith(`${baseKey}.b`))
}

module.exports = {
    SPACE_MAP_BUCKET_COUNT,
    SPACE_MAP_LAYOUT_KEY,
    SPACE_MAP_LAYOUT_BUCKETED,
    spaceMapBucketKey,
    spaceMapBucketIndex,
    spaceMapBucketKeys,
    spaceMapStorageKeys,
    spaceMapStorageReadDefaults,
    isSpaceMapStorageKey,
    splitSpaceMapIntoBuckets,
    readSpaceMapFromStored,
    hashSpaceMapBuckets,
    changedSpaceMapBuckets
}
