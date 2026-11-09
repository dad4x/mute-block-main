// Coordinator source/provenance materialization extracted from sw.js
// (decomposition Slice 18). This is the cluster that infers and merges a
// coordinator item's `source`/`sources` metadata from its run's metadata and
// diagnostic events, normalizes/validates a `provenance` payload attached to
// an incoming queue item, and the profile-removal-driven derived-state
// cleanup that strips a cleared profile's href out of progress records and
// coordinator runs. (The pending and remembered space-post maps were removed, 25 Oct.)
//
// All 14 functions here are plain synchronous functions with no `async`
// keyword and no Promise/`.then()`/`.catch()` chain in their bodies (grepped
// every body before moving, per architecture.md's "Module Extraction And
// The Test Harness Realm Boundary" section, "Refinement found during ...
// Slice 7" paragraph) -- none of them carry any realm-crossing risk in
// either direction. None of them reads Date.now() (or any other faked
// environment global) either, so there is no clock dep to thread through
// per the plan's clock/environment-global note.
//
// Construction-order note: two already-extracted modules eagerly reference
// names from this cluster at their own construction-call site --
// coordinatorReconcileInputs (createCoordinatorReconcileInputs, further down
// in sw.js) references getCoordinatorProgressRecordForItem twice in its
// `handlers` object literal, and coordinatorQueueView
// (createCoordinatorQueueView, further down still) references
// normalizeCoordinatorItemProvenance in its own `handlers` object literal.
// A `const` destructured from a factory call is in the temporal dead zone
// until that line executes, so this module must construct in sw.js before
// the earliest of those two eager references (coordinatorReconcileInputs).
// This module's own dependencies are all satisfied well before that point:
// normalizeQuoraProfileUrl and getWalRecordsForGeneration come straight from
// the subject.js/swstorage.js requires at the very top of sw.js;
// COORDINATOR_QUEUE_WAL_KEY and defaults are top-level consts/requires from
// the same region; normalizeCoordinatorEvents comes from
// coordinatorAttemptIdentity's destructure and getCoordinatorRunIdsForHref
// from coordinatorRuns's destructure, both well above this point;
// normalizeQueueWriteOperationName comes from storageMetrics's destructure,
// the latest of this module's five already-extracted-module dependencies --
// so this module constructs in sw.js immediately after storageMetrics's
// related setup and immediately before coordinatorReconcileInputs, the
// earliest eager dependent. getCoordinatorItemHref and
// removeProfileHrefFromCoordinatorRuns stay in sw.js as plain
// hoisted function declarations (untouched by this slice, defined much
// further below) and are threaded through as handler deps -- hoisted
// declarations are visible from anywhere in their enclosing scope
// regardless of textual position, so no TDZ concern on their side.
//
// getHydratedCoordinatorAuthorityState, refreshResidentCoordinatorAuthorityState,
// cloneCoordinatorAuthorityValue, createCoordinatorAuthority, and the
// queue-WAL async cluster are all explicitly out of scope for
// this decomposition effort (see the plan's "Boundary after Slice 17"
// section) and are untouched here.

function createCoordinatorSourceProvenance(deps = {}) {
    const {
        COORDINATOR_QUEUE_WAL_KEY
    } = deps.constants || {}
    const {
        normalizeQuoraProfileUrl,
        getCoordinatorItemHref,
        getWalRecordsForGeneration,
        normalizeQueueWriteOperationName,
        getCoordinatorRunIdsForHref,
        removeProfileHrefFromCoordinatorRuns
    } = deps.handlers || {}

    function getChangedProfileProgressRecords(oldRecords = {}, newRecords = {}) {
        const changedRecords = {}

        for(const [href, record] of Object.entries(newRecords || {})) {
            if(!record || typeof record !== 'object') continue
            if(JSON.stringify(record) === JSON.stringify(oldRecords?.[href] || null)) continue

            changedRecords[href] = record
        }

        return changedRecords
    }

    function getCoordinatorProgressRecordForItem(itemKey = '', item = {}, progress = {}) {
        const candidates = [
            itemKey,
            item?.targetProfileHref,
            item?.dedupeKey,
            item?.requestedUrl
        ]

        for(const candidate of candidates) {
            const normalized = normalizeQuoraProfileUrl(candidate || '')
            if(normalized && progress[normalized]) return progress[normalized]
            if(candidate && progress[candidate]) return progress[candidate]
        }

        return null
    }

    function inferSourceTypeFromRunId(runId = '') {
        const match = `${runId || ''}`.match(/^(.+)-\d{10,}-[a-z0-9]+$/i)
        return match?.[1] || ''
    }

    function getProfileSearchQueryFromPageUrl(pageUrl = '') {
        try {
            return new URL(pageUrl).searchParams.get('q') || ''
        }
        catch {
            return ''
        }
    }

    function makeCoordinatorSourceFromRunMetadata(runId = '', run = {}) {
        const sourceType = run.sourceType || inferSourceTypeFromRunId(runId) || 'profile-list'
        // Decision 26 (18 Oct): the run's own source pages are the only source. The event log is not read.
        const sourcePageUrl = (Array.isArray(run.sourcePages) && run.sourcePages.find(Boolean)) || ''
        const source = {
            type: sourceType,
            pageUrl: sourcePageUrl
        }

        if(sourceType === 'profile-search') {
            const searchQuery = getProfileSearchQueryFromPageUrl(sourcePageUrl)
            if(searchQuery) {
                source.searchQuery = searchQuery
                source.sourceLabel = searchQuery
            }
        }

        return source
    }

    function mergeCoordinatorSourceMetadata(existing = {}, inferred = {}) {
        if(!inferred || typeof inferred !== 'object') return existing || {}

        const next = existing && typeof existing === 'object' ? {...existing} : {}
        if(!next.type && inferred.type) next.type = inferred.type
        if(!next.pageUrl && inferred.pageUrl) next.pageUrl = inferred.pageUrl
        if(!next.searchQuery && inferred.searchQuery) next.searchQuery = inferred.searchQuery
        if(!next.sourceLabel && inferred.sourceLabel) next.sourceLabel = inferred.sourceLabel
        return next
    }

    function normalizeCoordinatorProvenanceSpaceUrl(value = '') {
        try {
            const url = new URL(`${value || ''}`)
            if(!/\.quora\.com$/i.test(url.hostname)) return ''
            url.hash = ''
            url.search = ''
            if(!url.pathname || url.pathname === '/') url.pathname = '/'
            return url.href
        }
        catch {
            return ''
        }
    }

    function normalizeCoordinatorItemProvenance(value = null) {
        if(!value || typeof value !== 'object') return null

        const provenance = {
            kind: `${value.kind || value.type || ''}`.trim(),
            source: `${value.source || ''}`.trim(),
            sourceSpaceUrl: normalizeCoordinatorProvenanceSpaceUrl(value.sourceSpaceUrl || ''),
            sourceSpaceTitle: `${value.sourceSpaceTitle || ''}`.trim(),
            snippet: `${value.snippet || ''}`.replace(/\s+/g, ' ').trim().slice(0, 500),
            collectionIndex: Number.parseInt(value.collectionIndex, 10) || 0,
            assetFixturePath: `${value.assetFixturePath || ''}`.trim(),
            assetFixtureGeneratedAt: `${value.assetFixtureGeneratedAt || ''}`.trim()
        }

        if(!Object.values(provenance).some(Boolean)) return null
        return provenance
    }

    function applyCoordinatorSourceMetadataMaterialization(item = {}, inferred = {}) {
        if(!item || typeof item !== 'object' || !inferred?.type) return item

        let changed = false
        const next = {...item}
        const mergedSource = mergeCoordinatorSourceMetadata(next.source || {}, inferred)
        if(JSON.stringify(mergedSource) !== JSON.stringify(next.source || {})) {
            next.source = mergedSource
            changed = true
        }

        const sources = Array.isArray(next.sources) ? next.sources : []
        let matchedSource = false
        const materializedSources = sources.map(source => {
            if(!source || typeof source !== 'object') return source
            if(source.type && source.type !== inferred.type) return source
            matchedSource = true
            const merged = mergeCoordinatorSourceMetadata(source, inferred)
            if(JSON.stringify(merged) !== JSON.stringify(source)) changed = true
            return merged
        })

        if(!matchedSource && (inferred.pageUrl || inferred.searchQuery)) {
            materializedSources.push({...inferred})
            changed = true
        }
        if(changed) next.sources = materializedSources

        if(inferred.pageUrl && next.scope && typeof next.scope === 'object' && !next.scope.sourcePageUrl) {
            next.scope = {
                ...next.scope,
                type: next.scope.type || inferred.type,
                sourcePageUrl: inferred.pageUrl
            }
            changed = true
        }

        return changed ? next : item
    }

    function getCoordinatorQueueProfileHrefSet(queue = {}) {
        const hrefs = new Set()

        for(const [itemKey, item] of Object.entries(queue || {})) {
            const href = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(itemKey)
            if(href) hrefs.add(href)
        }

        return hrefs
    }

    function getClearProfileWalRemovedProfileHrefs(stored = {}) {
        const walStore = stored?.[COORDINATOR_QUEUE_WAL_KEY] || null
        const activeGenerationId = walStore?.meta?.activeCheckpoint || ''
        if(!walStore || !activeGenerationId) return new Set()

        return new Set(getWalRecordsForGeneration(walStore, activeGenerationId)
            .filter(record => record?.kind === 'map.remove' &&
                normalizeQueueWriteOperationName(record.operationKind || '') === 'clear-profile')
            .map(record => normalizeQuoraProfileUrl(record.key || record.profileHref || ''))
            .filter(Boolean))
    }

    function removeProfileHrefFromProgressRecords(progress = {}, normalizedHref = '') {
        let changed = false

        for(const [key, record] of Object.entries(progress || {})) {
            const href = normalizeQuoraProfileUrl(record?.profileHref || key || '')
            if(href !== normalizedHref) continue

            delete progress[key]
            changed = true
        }

        return changed
    }

    function materializeRemovedProfileDerivedStateFromAuthority(state = {}) {
        const removedHrefs = getClearProfileWalRemovedProfileHrefs(state.stored || {})
        if(!removedHrefs.size) {
            return {
                changed: false,
                progressChanged: false,
                runsChanged: false,
                affectedRunIds: [],
                materialized: 0,
                runs: state.runs || {}
            }
        }

        const liveHrefs = getCoordinatorQueueProfileHrefSet(state.queue || {})
        const progress = state.progress || {}
        let runs = state.runs || {}
        const affectedRunIds = new Set()
        let progressChanged = false
        let runsChanged = false
        let materialized = 0

        for(const href of removedHrefs) {
            if(liveHrefs.has(href)) continue

            let hrefChanged = false
            if(removeProfileHrefFromProgressRecords(progress, href)) {
                progressChanged = true
                hrefChanged = true
            }
            const hrefRunIds = getCoordinatorRunIdsForHref(runs, href)
            const runsResult = removeProfileHrefFromCoordinatorRuns(runs, state.queue || {}, href)
            if(runsResult.changed) {
                runs = runsResult.runs
                runsChanged = true
                hrefChanged = true
                for(const runId of hrefRunIds) {
                    if(runId) affectedRunIds.add(runId)
                }
            }

            if(hrefChanged) materialized += 1
        }

        return {
            changed: progressChanged || runsChanged,
            progressChanged,
            runsChanged,
            affectedRunIds: Array.from(affectedRunIds),
            materialized,
            runs
        }
    }

    return {
        getChangedProfileProgressRecords,
        getCoordinatorProgressRecordForItem,
        inferSourceTypeFromRunId,
        getProfileSearchQueryFromPageUrl,
        makeCoordinatorSourceFromRunMetadata,
        mergeCoordinatorSourceMetadata,
        normalizeCoordinatorProvenanceSpaceUrl,
        normalizeCoordinatorItemProvenance,
        applyCoordinatorSourceMetadataMaterialization,
        getCoordinatorQueueProfileHrefSet,
        getClearProfileWalRemovedProfileHrefs,
        removeProfileHrefFromProgressRecords,
        materializeRemovedProfileDerivedStateFromAuthority
    }
}

module.exports = {
    createCoordinatorSourceProvenance
}
