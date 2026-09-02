// Resolved-profile pending-space-record cleanup extracted from sw.js
// (decomposition Slice 39, part 1 of 2): addResolvedProfileToPendingSpaceRecords,
// clearResolverPendingSpaceRecords.
//
// Promise-chain realm-crossing scrutiny (per architecture.md's Slice-7
// refinement): both bodies were grepped for `.then(`, `.catch(`, `Promise.`,
// `async`, `setTimeout`, and `void`. No matches -- both are plain
// data-in/data-out builders with no Promise touched anywhere, including
// transitively through their handler calls (all of which are themselves
// plain synchronous builders/predicates). No realm-crossing risk either
// direction.
//
// Clock note: both bodies call `Date.now()` directly when stamping
// `updatedAt` on the records they build -- threaded through as `now`,
// matching the existing `schedulerClock`-style convention used elsewhere in
// this codebase, per the plan's clock/environment-global note.
//
// Construction-order note: this module is constructed well before this
// cluster's old source-text location, immediately after
// reconcileCoordinatorStorageBestEffort's definition and before
// coordinatorReconcileLockedMaterialization's construction (decomposition
// Slice 19) -- coordinatorReconcileLockedMaterialization eagerly references
// bare `addResolvedProfileToPendingSpaceRecords` and
// `clearResolverPendingSpaceRecords` in its own construction-call `handlers`
// object literal. A `const` destructured from a factory call is in the
// temporal dead zone until that line executes, so this module must
// construct before that reference. Every dependency this module needs is
// already available bare by that point: normalizeQuoraProfileUrl
// (top-of-file ./subject require), getNormalizedProfileHrefList,
// stripProfileResolutionQueueKey, normalizeCoordinatorRequestedUrl
// (profileResolution, decomposition Slice 10), and
// getStoredSpaceFeedRecordUrls/getPendingSpaceFeedJobKeyPatch
// (coordinatorJobEnvelope, decomposition Slice 11).

function createResolvedProfilePendingSpaceRecords(deps = {}) {
    const {
        now = () => Date.now()
    } = deps
    const {
        normalizeQuoraProfileUrl,
        getNormalizedProfileHrefList,
        getStoredSpaceFeedRecordUrls,
        getPendingSpaceFeedJobKeyPatch,
        stripProfileResolutionQueueKey,
        normalizeCoordinatorRequestedUrl
    } = deps.handlers || {}

    function addResolvedProfileToPendingSpaceRecords(pendingPosts = {}, item = {}, resolvedHref = '') {
        const href = normalizeQuoraProfileUrl(resolvedHref)
        if(!href) return {pendingPosts, changed: false}

        const nextPending = {
            ...pendingPosts
        }
        let changed = false
        const evidenceList = Array.isArray(item?.evidence) ? item.evidence : []

        for(const evidence of evidenceList) {
            const postKey = evidence?.postKey || ''
            if(!postKey) continue

            const existing = nextPending[postKey] || {}
            const allUrls = getNormalizedProfileHrefList([
                ...getStoredSpaceFeedRecordUrls(existing, 'allUrls'),
                href
            ])
            const remainingUrls = getNormalizedProfileHrefList([
                ...getStoredSpaceFeedRecordUrls(existing, 'remainingUrls'),
                href
            ])

            nextPending[postKey] = {
                ...existing,
                postKey,
                postUrl: evidence.postUrl || existing.postUrl || '',
                spaceKey: item?.source?.spaceKey || existing.spaceKey || '',
                spaceUrl: item?.source?.pageUrl || existing.spaceUrl || '',
                allUrls,
                remainingUrls,
                resolverPending: false,
                resolverUrl: evidence.postUrl || existing.resolverUrl || '',
                ...getPendingSpaceFeedJobKeyPatch(existing, remainingUrls),
                updatedAt: now()
            }
            changed = true
        }

        return {pendingPosts: nextPending, changed}
    }

    function clearResolverPendingSpaceRecords(pendingPosts = {}, item = {}, options = {}) {
        const nextPending = {
            ...pendingPosts
        }
        const evidenceList = Array.isArray(item?.evidence) ? item.evidence : []
        const requestEvidence = Array.isArray(options.evidence) ? options.evidence : []
        const postKeys = new Set([options.postKey, item?.postKey]
            .concat(evidenceList.map(evidence => evidence?.postKey))
            .concat(requestEvidence.map(evidence => evidence?.postKey))
            .map(value => `${value || ''}`.trim())
            .filter(Boolean))
        const resolverUrls = new Set([
            options.requestedUrl,
            item?.requestedUrl,
            stripProfileResolutionQueueKey(item?.coordinatorKey || item?.dedupeKey || '')
        ]
            .concat(evidenceList.map(evidence => evidence?.postUrl))
            .concat(requestEvidence.map(evidence => evidence?.postUrl))
            .map(value => normalizeCoordinatorRequestedUrl(value || ''))
            .filter(Boolean))
        let changed = false

        for(const [recordKey, record] of Object.entries(pendingPosts || {})) {
            if(record?.resolverPending !== true) continue

            const recordPostKey = `${record?.postKey || recordKey || ''}`.trim()
            const recordUrls = [
                normalizeCoordinatorRequestedUrl(record?.resolverUrl || ''),
                normalizeCoordinatorRequestedUrl(record?.postUrl || '')
            ].filter(Boolean)
            const matches = (recordPostKey && postKeys.has(recordPostKey)) ||
                recordUrls.some(url => resolverUrls.has(url))
            if(!matches) continue

            const allUrls = getStoredSpaceFeedRecordUrls(record, 'allUrls')
            const remainingUrls = getStoredSpaceFeedRecordUrls(record, 'remainingUrls')
            changed = true

            if(!allUrls.length && !remainingUrls.length) {
                delete nextPending[recordKey]
                continue
            }

            nextPending[recordKey] = {
                ...record,
                allUrls,
                remainingUrls,
                resolverPending: false,
                resolverUrl: '',
                ...getPendingSpaceFeedJobKeyPatch(record, remainingUrls),
                updatedAt: now()
            }
        }

        return {pendingPosts: nextPending, changed}
    }

    return {
        addResolvedProfileToPendingSpaceRecords,
        clearResolverPendingSpaceRecords
    }
}

module.exports = {
    createResolvedProfilePendingSpaceRecords
}
