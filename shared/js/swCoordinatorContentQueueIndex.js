// Coordinator content-queue-index sharding functions extracted from sw.js
// (decomposition Slice 14). This is the content-page projection layer built
// on top of swCoordinatorQueueView.js (Slice 13) and swCoordinatorStatusRules.js
// (Slice 12): the per-item content-queue summary, the inclusion predicate,
// the compact content-queue index builder, the source-key hashing/sharding
// helpers used to fan queue items out across mbCoordinatorContentSourceIndex.*
// shards, the shard-payload builders, the combined derived-projection payload
// builder, and the queue WAL checkpoint constructor.
//
// Construction-order note: swCoordinatorQueueWal.js's construction call
// (`createCoordinatorQueueWalStore`, further below in sw.js) eagerly
// references `makeCoordinatorQueueWalCheckpoint` in its own `authority` deps
// object literal -- the same TDZ hazard documented for Slices 11 and 12. This
// module therefore must construct before that call. It also depends on
// buildCoordinatorQueueView/summarizeCoordinatorQueueViewItem/
// getCoordinatorQueueViewSortRank/getCoordinatorQueueViewTime from
// coordinatorQueueView (Slice 13) and on isTerminalCoordinatorStatus from
// coordinatorStatusRules (Slice 12), both constructed earlier in the file, so
// this module constructs in place at the cluster's old source-text position
// -- after both of those and well before coordinatorQueueWal's construction
// call -- satisfying both constraints at once.
//
// Every body was grepped for `.then(`, `.catch(`, `Promise.`, `async`, and
// `setTimeout` before moving, per architecture.md's Slice-7 realm-crossing
// refinement -- none of the 13 functions has any of these, so no realm-
// crossing risk.
//
// Clock note: buildCoordinatorContentQueueIndex, buildCoordinatorContentSourceIndexShardPayload,
// buildCoordinatorQueueDerivedProjectionPayload, and makeCoordinatorQueueWalCheckpoint
// all read Date.now() via a default parameter (`now = Date.now()` /
// `createdAt = ... || Date.now()`), which -- per the Slice 12/13 clock-note
// precedent -- evaluates in the *defining* function's own realm when the
// caller omits the argument, not the caller's. `now` is threaded through
// this module's deps as `() => Date.now()` and each default parameter reads
// `now()` instead.
//
// cloneCoordinatorAuthorityValue is explicitly out of scope for this
// decomposition effort (see the plan's "Boundary after Slice 17" section) --
// it stays a bare hoisted function declaration in sw.js and is threaded
// through as a handler dep rather than moved.

function createCoordinatorContentQueueIndex(deps = {}) {
    const {now} = deps
    const {
        getCoordinatorItemHref,
        normalizeQuoraProfileUrl,
        normalizeContentPageStateUrl,
        getCoordinatorItemStateSources,
        isTerminalCoordinatorStatus,
        getAttemptIdFromValue,
        getAttemptNumberFromValue,
        summarizeCoordinatorQueueViewItem,
        getCoordinatorQueueViewSortRank,
        getCoordinatorQueueViewTime,
        buildCoordinatorQueueView,
        normalizeCoordinatorMap,
        cloneCoordinatorAuthorityValue,
        hashProjectionShardKey,
        getProjectionShardKeyByIndex,
        getProjectionShardKey,
        makeProjectionShardDefaults,
        makePairedCheckpointStore
    } = deps.handlers || {}
    const {
        COORDINATOR_QUEUE_VIEW_KEY,
        COORDINATOR_CONTENT_QUEUE_INDEX_KEY,
        COORDINATOR_CONTENT_QUEUE_INDEX_SHARD_PREFIX,
        COORDINATOR_CONTENT_QUEUE_INDEX_SHARD_COUNT,
        COORDINATOR_CONTENT_SOURCE_INDEX_PREFIX,
        COORDINATOR_CONTENT_SOURCE_INDEX_SHARD_COUNT,
        MAX_COORDINATOR_CONTENT_QUEUE_INDEX_ITEMS
    } = deps.constants || {}

    function summarizeCoordinatorContentQueueItem(key = '', item = {}) {
        const source = item && typeof item === 'object' ? item : {}
        const profileHref = getCoordinatorItemHref(source) || normalizeQuoraProfileUrl(key)
        return {
            ...summarizeCoordinatorQueueViewItem(key, source),
            profileHref,
            tabId: Number.isFinite(source.tabId) ? source.tabId : source.tabId || null,
            attemptId: getAttemptIdFromValue(source),
            attemptNumber: getAttemptNumberFromValue(source),
            maxAttempts: Number.parseInt(source.maxAttempts, 10) || 0
        }
    }

    function shouldIncludeCoordinatorItemInContentQueueIndex(item = null) {
        if(!item || typeof item !== 'object') return false
        return !isTerminalCoordinatorStatus(item.status)
    }

    function buildCoordinatorContentQueueIndex(queue = {}, nowMs = now()) {
        const entries = Object.entries(queue || {})
            .filter(([, item]) => shouldIncludeCoordinatorItemInContentQueueIndex(item))
            .sort((left, right) => {
                const leftItem = left[1] || {}
                const rightItem = right[1] || {}
                return getCoordinatorQueueViewSortRank(leftItem) - getCoordinatorQueueViewSortRank(rightItem) ||
                    getCoordinatorQueueViewTime(rightItem) - getCoordinatorQueueViewTime(leftItem) ||
                    `${left[0]}`.localeCompare(`${right[0]}`)
            })
        const items = entries
            .slice(0, MAX_COORDINATOR_CONTENT_QUEUE_INDEX_ITEMS)
            .map(([key, item]) => summarizeCoordinatorContentQueueItem(key, item))

        return {
            version: 2,
            updatedAt: nowMs,
            total: Object.keys(queue || {}).length,
            indexed: entries.length,
            itemLimit: MAX_COORDINATOR_CONTENT_QUEUE_INDEX_ITEMS,
            truncated: entries.length > items.length,
            items
        }
    }

    function hashCoordinatorContentIndexKey(value = '', bucketCount = COORDINATOR_CONTENT_SOURCE_INDEX_SHARD_COUNT) {
        return hashProjectionShardKey(value, bucketCount)
    }

    // 2026-10-07: additive sibling of buildCoordinatorContentQueueIndex above,
    // not a replacement -- live traffic confirmed getContentPageCoordinatorState
    // (every Quora content page's "what's my queue status" poll) was reading
    // that function's full-queue blob in full every time (1.09MB avg this
    // session, scaling directly with backlog depth: COORDINATOR_CONTENT_QUEUE_INDEX_KEY
    // covers up to MAX_COORDINATOR_CONTENT_QUEUE_INDEX_ITEMS items from the
    // WHOLE live queue), then filtering it down to the handful of profileHrefs
    // that one page actually asked about. Mirrors the already-proven pattern
    // from profile-nuke-progress sharding and the sibling content-source-index
    // sharding (both already shard by a hashed key and let a scoped request
    // fetch only the relevant bucket) -- reuses the exact same shared
    // hashProjectionShardKey/getProjectionShardKey/makeProjectionShardDefaults
    // helpers those two already use, not a new scheme. Keyed by normalized
    // profileHref (direct dict lookup within a shard, same as how progress
    // shards key by href), not by the queue's own storage key, since callers
    // always ask "is profile X in the queue", never "is storage key Y".
    //
    // The existing COORDINATOR_CONTENT_QUEUE_INDEX_KEY write is left fully
    // intact (same shape, same call sites) specifically because many existing
    // tests assert its exact fields (items/truncated/total/indexed) -- this
    // only ADDS a second, additional representation alongside it for the hot
    // read path to prefer instead.
    function getCoordinatorContentQueueIndexShardKey(profileHref = '') {
        return getProjectionShardKey(
            COORDINATOR_CONTENT_QUEUE_INDEX_SHARD_PREFIX,
            COORDINATOR_CONTENT_QUEUE_INDEX_SHARD_COUNT,
            normalizeQuoraProfileUrl(profileHref) || profileHref
        )
    }

    function getCoordinatorContentQueueIndexShardDefaults(profileHrefs = []) {
        const defaults = {}
        for(const href of profileHrefs || []) {
            const key = getCoordinatorContentQueueIndexShardKey(href)
            if(key) defaults[key] = {}
        }
        return defaults
    }

    function buildCoordinatorContentQueueIndexShardPayload(queue = {}, nowMs = now()) {
        const shards = makeProjectionShardDefaults(
            COORDINATOR_CONTENT_QUEUE_INDEX_SHARD_PREFIX,
            COORDINATOR_CONTENT_QUEUE_INDEX_SHARD_COUNT,
            () => ({version: 1, updatedAt: nowMs, records: {}})
        )

        for(const [itemKey, item] of Object.entries(queue || {})) {
            if(!shouldIncludeCoordinatorItemInContentQueueIndex(item)) continue
            const summary = summarizeCoordinatorContentQueueItem(itemKey, item)
            const href = summary.profileHref || normalizeQuoraProfileUrl(itemKey) || itemKey
            const shardKey = getCoordinatorContentQueueIndexShardKey(href)
            if(!shardKey) continue
            shards[shardKey].records[href] = summary
        }

        return shards
    }

    function getCoordinatorContentSourceIndexShardKeyByIndex(index = 0) {
        return getProjectionShardKeyByIndex(
            COORDINATOR_CONTENT_SOURCE_INDEX_PREFIX,
            COORDINATOR_CONTENT_SOURCE_INDEX_SHARD_COUNT,
            index
        )
    }

    function getCoordinatorContentSourceIndexShardKey(sourceKey = '') {
        return getProjectionShardKey(
            COORDINATOR_CONTENT_SOURCE_INDEX_PREFIX,
            COORDINATOR_CONTENT_SOURCE_INDEX_SHARD_COUNT,
            sourceKey
        )
    }

    function getCoordinatorContentSourceKeysFromValues(pageUrl = '', searchQuery = '', sourceType = '') {
        const keys = []
        const normalizedPageUrl = normalizeContentPageStateUrl(pageUrl || '')
        if(normalizedPageUrl) keys.push(`url:${normalizedPageUrl}`)

        const normalizedQuery = `${searchQuery || ''}`.trim().toLowerCase()
        if(normalizedQuery && (!sourceType || `${sourceType || ''}` === 'profile-search')) {
            keys.push(`profile-search:${normalizedQuery}`)
        }

        return Array.from(new Set(keys))
    }

    function getCoordinatorContentSourceKeysForItem(item = null) {
        const keys = []
        for(const source of getCoordinatorItemStateSources(item)) {
            keys.push(...getCoordinatorContentSourceKeysFromValues(
                source?.pageUrl || source?.sourcePageUrl || '',
                source?.searchQuery || '',
                source?.type || ''
            ))
        }
        return Array.from(new Set(keys))
    }

    function getCoordinatorContentSourceKeysForRequest(request = {}) {
        return getCoordinatorContentSourceKeysFromValues(
            request.sourcePageUrl || request.url || '',
            request.searchQuery || '',
            'profile-search'
        )
    }

    function getCoordinatorContentSourceIndexShardDefaults(request = {}) {
        const defaults = {}
        for(const sourceKey of getCoordinatorContentSourceKeysForRequest(request)) {
            const shardKey = getCoordinatorContentSourceIndexShardKey(sourceKey)
            if(shardKey) defaults[shardKey] = {}
        }
        return defaults
    }

    function buildCoordinatorContentSourceIndexShardPayload(queue = {}, nowMs = now()) {
        const shards = makeProjectionShardDefaults(
            COORDINATOR_CONTENT_SOURCE_INDEX_PREFIX,
            COORDINATOR_CONTENT_SOURCE_INDEX_SHARD_COUNT,
            () => ({
                version: 1,
                updatedAt: nowMs,
                records: {}
            })
        )

        for(const [itemKey, item] of Object.entries(queue || {})) {
            if(!shouldIncludeCoordinatorItemInContentQueueIndex(item)) continue
            const summary = summarizeCoordinatorContentQueueItem(itemKey, item)
            const sourceKeys = getCoordinatorContentSourceKeysForItem(item)
            for(const sourceKey of sourceKeys) {
                const shardKey = getCoordinatorContentSourceIndexShardKey(sourceKey)
                if(!shardKey) continue
                if(!shards[shardKey].records[sourceKey]) {
                    shards[shardKey].records[sourceKey] = {
                        items: []
                    }
                }
                shards[shardKey].records[sourceKey].items.push(summary)
            }
        }

        return shards
    }

    // 2026-10-01: no longer includes COORDINATOR_QUEUE_VIEW_KEY -- see
    // refreshCoordinatorQueueViewForDashboard's own comment in sw.js for why
    // mbCoordinatorQueueView is never persisted. Every call site that used to
    // get the queue view "for free" as part of this bundle now broadcasts it
    // separately via notifyCoordinatorDashboardStateChanged instead.
    // content-queue-index/source-index are not stored: they are derived in memory
    // from the resident queue (readResidentDerivedQueueIndex in sw.js), so nothing writes them to disk.
    function buildCoordinatorQueueDerivedProjectionPayload(queue = {}, nowMs = now()) {
        return {
            [COORDINATOR_CONTENT_QUEUE_INDEX_KEY]: buildCoordinatorContentQueueIndex(queue, nowMs),
            ...buildCoordinatorContentQueueIndexShardPayload(queue, nowMs),
            ...buildCoordinatorContentSourceIndexShardPayload(queue, nowMs)
        }
    }

    // Builds a queue-only WAL checkpoint. Callers: the empty-fallback in swCoordinatorQueueWal.js and the WAL store's makeCheckpoint
    // (sw.js). None of them passes runs, so the checkpoint holds the queue alone.
    function makeCoordinatorQueueWalCheckpoint(queue = {}, options = {}) {
        const state = {queue: normalizeCoordinatorMap(cloneCoordinatorAuthorityValue(queue || {}))}
        return makePairedCheckpointStore(state, {
            snapshotSeq: Number.parseInt(options.snapshotSeq, 10) || 0,
            nextSeq: Number.parseInt(options.nextSeq, 10) || 1,
            createdAt: Number.parseInt(options.createdAt, 10) || now()
        })
    }

    return {
        summarizeCoordinatorContentQueueItem,
        shouldIncludeCoordinatorItemInContentQueueIndex,
        buildCoordinatorContentQueueIndex,
        getCoordinatorContentQueueIndexShardKey,
        getCoordinatorContentQueueIndexShardDefaults,
        buildCoordinatorContentQueueIndexShardPayload,
        hashCoordinatorContentIndexKey,
        getCoordinatorContentSourceIndexShardKeyByIndex,
        getCoordinatorContentSourceIndexShardKey,
        getCoordinatorContentSourceKeysFromValues,
        getCoordinatorContentSourceKeysForItem,
        getCoordinatorContentSourceKeysForRequest,
        getCoordinatorContentSourceIndexShardDefaults,
        buildCoordinatorContentSourceIndexShardPayload,
        buildCoordinatorQueueDerivedProjectionPayload,
        makeCoordinatorQueueWalCheckpoint
    }
}

module.exports = {
    createCoordinatorContentQueueIndex
}
