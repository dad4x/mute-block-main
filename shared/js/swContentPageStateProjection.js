// Content-page-state projection helper functions extracted from sw.js
// (decomposition Slice 42). This is the read-side layer that scopes the
// full coordinator queue index / content-source-index shards / profile-nuke
// progress view down to just the rows relevant to a single content-page
// request (`get-content-page-coordinator-state`): URL normalization for
// matching, the per-item/per-source "does this belong on this page"
// predicates, the queue-index/source-index-shard/progress-view normalizers
// applied to whatever was read from storage, and the missing-shard /
// truncated-fallback predicates that decide whether the scoped projection
// needs a full-queue fallback load.
//
// Construction-order note: two already-extracted modules eagerly reference
// functions from this cluster in their own construction-call handler object
// literals -- the same TDZ hazard documented for Slices 11, 12, and 14:
//   - swCoordinatorContentQueueIndex.js's construction call
//     (`createCoordinatorContentQueueIndex`) references `normalizeContentPageStateUrl`
//     and `getCoordinatorItemStateSources`.
//   - swProfileNukeProgress.js's construction call (`createProfileNukeProgress`)
//     references `normalizeProfileNukeProgressView`.
// This module therefore must construct before both of those calls, i.e.
// before `coordinatorContentQueueIndex` (the earlier of the two) in sw.js.
// That in turn means one of this module's own deps -- `getCoordinatorContentSourceKeysForRequest`,
// needed by `normalizeCoordinatorContentSourceIndexRecords` -- isn't
// available as a bare const yet at that point (it's destructured from
// `coordinatorContentQueueIndex`'s own return value, further below), so it's
// threaded through as a thunk, matching the
// queuedTabOpenUrlCommitHelpers/getTabObservedUrls precedent. `getCoordinatorItemHref`
// (coordinatorExecutorClassification), `getNormalizedProfileHrefList`
// (profileResolution), `normalizeStoredProfileNukeProgress`
// (profileProgressMerge), and `normalizeQuoraProfileUrl` (top-of-file
// require) are all already bare names in scope by this point in sw.js, so
// each is threaded through directly.
//
// Every body was grepped for `.then(`, `.catch(`, `Promise.`, `async`,
// `setTimeout`, and `void` before moving, per architecture.md's Slice-7
// realm-crossing refinement -- none of the 11 functions has any of these,
// so no realm-crossing risk. None reads `Date.now()` either, so no clock dep
// is needed.

function createContentPageStateProjection(deps = {}) {
    const {
        getCoordinatorItemHref,
        normalizeQuoraProfileUrl,
        getNormalizedProfileHrefList,
        normalizeStoredProfileNukeProgress,
        getCoordinatorContentSourceKeysForRequest
    } = deps.handlers || {}

    function normalizeContentPageStateUrl(value = '') {
        try {
            const url = new URL(`${value || ''}`)
            url.hash = ''
            return url.href
        }
        catch {
            return `${value || ''}`.split('#')[0]
        }
    }

    function getCoordinatorItemStateSources(item = null) {
        const sources = []
        if(item?.source && typeof item.source === 'object') sources.push(item.source)
        if(Array.isArray(item?.sources)) {
            sources.push(...item.sources.filter(source => source && typeof source === 'object'))
        }
        if(Array.isArray(item?.evidence)) {
            for(const evidence of item.evidence) {
                if(!evidence || typeof evidence !== 'object' || !evidence.sourcePageUrl) continue
                sources.push({
                    type: 'space-feed',
                    pageUrl: evidence.sourcePageUrl
                })
            }
        }
        return sources
    }

    function shouldIncludeCoordinatorItemForContentPage(itemKey = '', item = null, request = {}, profileHrefSet = new Set()) {
        if(!item || typeof item !== 'object') return false

        const profileHref = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(itemKey)
        if(profileHref && profileHrefSet.has(profileHref)) return true

        const requestRunId = `${request.runId || ''}`.trim()
        if(requestRunId && `${item.runId || ''}` === requestRunId) return true

        const requestSourcePageUrl = normalizeContentPageStateUrl(request.sourcePageUrl || request.url || '')
        const requestSearchQuery = `${request.searchQuery || ''}`.trim().toLowerCase()
        if(!requestSourcePageUrl && !requestSearchQuery) return false

        return getCoordinatorItemStateSources(item).some(source => {
            const sourceUrl = normalizeContentPageStateUrl(source?.pageUrl || source?.sourcePageUrl || '')
            if(requestSourcePageUrl && sourceUrl && sourceUrl === requestSourcePageUrl) return true
            return !!(
                requestSearchQuery &&
                `${source?.type || ''}` === 'profile-search' &&
                `${source?.searchQuery || ''}`.trim().toLowerCase() === requestSearchQuery
            )
        })
    }

    function shouldIncludeProfileProgressForContentPage(profileHref = '', record = null, request = {}, profileHrefSet = new Set()) {
        const href = normalizeQuoraProfileUrl(record?.profileHref || profileHref || '')
        if(!href) return false
        if(profileHrefSet.has(href)) return true

        const requestRunId = `${request.runId || ''}`.trim()
        return !!(requestRunId && `${record?.runId || ''}` === requestRunId)
    }

    function normalizeCoordinatorContentQueueIndex(index = null) {
        if(!index || typeof index !== 'object' || !Array.isArray(index.items)) {
            return {
                version: 0,
                updatedAt: 0,
                total: 0,
                itemLimit: 0,
                truncated: false,
                items: []
            }
        }

        return {
            version: Number.parseInt(index.version, 10) || 0,
            updatedAt: Number.parseInt(index.updatedAt, 10) || 0,
            total: Number.parseInt(index.total, 10) || index.items.length,
            itemLimit: Number.parseInt(index.itemLimit, 10) || index.items.length,
            truncated: index.truncated === true,
            items: index.items.filter(item => item && typeof item === 'object')
        }
    }

    function normalizeCoordinatorContentSourceIndexRecords(shards = {}, request = {}) {
        const sourceKeys = new Set(getCoordinatorContentSourceKeysForRequest(request))
        const scopedQueue = {}
        if(!sourceKeys.size) return scopedQueue

        for(const shard of Object.values(shards || {})) {
            const records = shard && typeof shard === 'object' && shard.records && typeof shard.records === 'object'
                ? shard.records
                : {}
            for(const sourceKey of sourceKeys) {
                const items = Array.isArray(records?.[sourceKey]?.items) ? records[sourceKey].items : []
                for(const item of items) {
                    if(!item || typeof item !== 'object') continue
                    const itemKey = item.storageKey || item.profileHref || item.targetProfileHref || item.id || ''
                    if(!itemKey) continue
                    scopedQueue[itemKey] = item
                }
            }
        }

        return scopedQueue
    }

    function normalizeProfileNukeProgressView(view = null) {
        if(!view || typeof view !== 'object' || !view.records || typeof view.records !== 'object') {
            return {
                version: 0,
                updatedAt: 0,
                total: 0,
                recordLimit: 0,
                truncated: false,
                records: {}
            }
        }

        return {
            version: Number.parseInt(view.version, 10) || 0,
            updatedAt: Number.parseInt(view.updatedAt, 10) || 0,
            total: Number.parseInt(view.total, 10) || Object.keys(view.records).length,
            recordLimit: Number.parseInt(view.recordLimit, 10) || Object.keys(view.records).length,
            truncated: view.truncated === true,
            records: normalizeStoredProfileNukeProgress(view.records)
        }
    }

    function hasMissingRequestedProfileProgressShard(progressView = null, shardDefaults = {}, stored = {}) {
        if(progressView?.truncated !== true) return false

        return Object.keys(shardDefaults || {}).some(key => {
            const shard = stored?.[key]
            return !shard ||
                typeof shard !== 'object' ||
                (Number.parseInt(shard.version, 10) || 0) < 1 ||
                !shard.records ||
                typeof shard.records !== 'object'
        })
    }

    function hasMissingRequestedCoordinatorSourceShard(queueIndex = null, sourceShardDefaults = {}, stored = {}) {
        if(queueIndex?.truncated !== true) return false

        return Object.keys(sourceShardDefaults || {}).some(key => {
            const shard = stored?.[key]
            return !shard ||
                typeof shard !== 'object' ||
                (Number.parseInt(shard.version, 10) || 0) < 1 ||
                !shard.records ||
                typeof shard.records !== 'object'
        })
    }

    function isContentPageStateProjectionMissing(queueIndex = null, progressView = null, shardDefaults = {}, stored = {}, sourceShardDefaults = {}) {
        return (Number.parseInt(queueIndex?.version, 10) || 0) < 2 ||
            (Number.parseInt(progressView?.version, 10) || 0) < 2 ||
            hasMissingRequestedCoordinatorSourceShard(queueIndex, sourceShardDefaults, stored) ||
            hasMissingRequestedProfileProgressShard(progressView, shardDefaults, stored)
    }

    function shouldLoadFullQueueForTruncatedContentPageState(queueIndex = null, request = {}, profileHrefs = [], scopedQueue = {}) {
        if(queueIndex?.truncated !== true) return false

        const scopedProfileHrefs = new Set(
            Object.entries(scopedQueue || {})
                .map(([itemKey, item]) => getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(itemKey))
                .filter(Boolean)
        )

        return getNormalizedProfileHrefList(profileHrefs || [])
            .some(href => !scopedProfileHrefs.has(href))
    }

    return {
        normalizeContentPageStateUrl,
        getCoordinatorItemStateSources,
        shouldIncludeCoordinatorItemForContentPage,
        shouldIncludeProfileProgressForContentPage,
        normalizeCoordinatorContentQueueIndex,
        normalizeCoordinatorContentSourceIndexRecords,
        normalizeProfileNukeProgressView,
        hasMissingRequestedProfileProgressShard,
        hasMissingRequestedCoordinatorSourceShard,
        isContentPageStateProjectionMissing,
        shouldLoadFullQueueForTruncatedContentPageState
    }
}

module.exports = {
    createContentPageStateProjection
}
