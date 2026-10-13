// Profile-resolution / coordinator subject-key predicates extracted from
// sw.js (decomposition Slice 10). These are the pure predicates, key
// builders, and progress-merge helpers a coordinator item uses to decide
// whether it's a "resolve a profile from a source page" job, what its
// dedupe/queue key and coordinator subject are, and whether a queued
// profile-resolution item points at something the reconcile core should
// refuse as invalid.
//
// All 21 functions here are plain synchronous functions with no
// `async` keyword and no Promise/`.then()`/`.catch()` chain in their
// bodies (grepped every body before moving, per architecture.md's
// "Module Extraction And The Test Harness Realm Boundary" section) --
// none of them carry any realm-crossing risk either direction. None of
// them read `Date.now()` or any other environment global the test
// harness fakes, so no clock dep needed either.
//
// recordQueueWakeupPhaseSamplesFromProgress, which sat in the middle of
// this cluster in file order (a consumer of swQueueWakeupMetricsShape.js's
// recordQueueWakeupPhase, not part of this domain), stayed resident in
// sw.js at the time of this slice, per the plan's explicit exclusion. It
// calls this module's getFirstPositiveNumber as a plain dep -- as of the
// sw.js decomposition mop-up slice (2026-09) it moved into
// swQueueWakeupMetricsShape.js itself instead (its actual consumer's own
// module), with getFirstPositiveNumber threaded through as a handler dep
// there rather than a bare sw.js reference.
//
// getCoordinatorItemQueueKey has 74 external references, several of them
// inside other already-extracted modules' `deps.handlers` object-literal
// shorthand (createActivationGuardRuntime, createQueuedTabRuntimeStatus)
// that are constructed eagerly at sw.js module-eval time, well before
// this cluster's old location in file order -- so is
// normalizeCoordinatorRequestedUrl, referenced eagerly at
// makeQueuedTabOpenUrlCommitHelpers's construction. Because a hoisted
// `function` declaration is visible throughout its whole scope but a
// `const` from a destructured factory call is not (TDZ) until that line
// executes, this module's construction and destructure was moved to sit
// immediately after queueWakeupMetricsShape's destructure and before
// queuedTabOpenUrlCommitHelpers's construction in sw.js -- earlier than
// this cluster's old source-text location -- rather than left in place
// like prior slices, so every eager reference below it still resolves.
// No scripted call-site rename was needed for getCoordinatorItemQueueKey
// or any other function here: every call site is a bare identifier
// reference, and the destructure-back-to-bare-name trick used by every
// prior slice keeps all of them working unedited.
//
// getCoordinatorItemHref stays in sw.js (a plain hoisted function
// declaration far below this module's new construction point) and is
// threaded through as a handler dep. normalizeQuoraProfileUrl and
// normalizeTabTargetUrl come from the already-required `./subject`
// module and are threaded through the same way.

function createProfileResolution(deps = {}) {
    const {
        MAX_PROFILE_NUKE_PROGRESS_ENTRIES,
        QUEUED_PROFILE_RESOLUTION_MODE,
        QUORA_NON_PROFILE_ROOT_PATHS
    } = deps.constants || {}
    const {
        normalizeQuoraProfileUrl,
        normalizeTabTargetUrl,
        getCoordinatorItemHref
    } = deps.handlers || {}

    function getFirstPositiveNumber(...values) {
        for(const value of values) {
            const number = Number.parseInt(value, 10) || 0
            if(number > 0) return number
        }
        return 0
    }

    function pruneProfileNukeProgress(records, maxEntries = MAX_PROFILE_NUKE_PROGRESS_ENTRIES) {
        const entries = Object.entries(records || {})
            .filter(([key, value]) => !!key && value && typeof value === 'object')
            .sort((left, right) => {
                const leftUpdatedAt = Number.isFinite(left[1].updatedAt) ? left[1].updatedAt : 0
                const rightUpdatedAt = Number.isFinite(right[1].updatedAt) ? right[1].updatedAt : 0
                return rightUpdatedAt - leftUpdatedAt || left[0].localeCompare(right[0])
            })

        if(maxEntries > 0 && entries.length > maxEntries) {
            entries.length = maxEntries
        }

        return Object.fromEntries(entries)
    }

    function mergeProfileProgressEvents(existingEvents = [], incomingEvents = []) {
        const seen = new Set()
        const merged = []

        for(const value of [...existingEvents, ...incomingEvents]) {
            const normalized = `${value || ''}`.trim()
            if(!normalized || seen.has(normalized)) continue
            seen.add(normalized)
            merged.push(normalized)
        }

        merged.sort()
        return merged.slice(-12)
    }

    function mergeUniqueStringList(...values) {
        const seen = new Set()
        const merged = []

        for(const value of values.flat()) {
            const normalized = `${value || ''}`.trim()
            if(!normalized || seen.has(normalized)) continue
            seen.add(normalized)
            merged.push(normalized)
        }

        return merged
    }

    function getNormalizedProfileHrefList(values = []) {
        const seen = new Set()
        const normalized = []

        for(const value of values || []) {
            const href = normalizeQuoraProfileUrl(value)
            if(!href || seen.has(href)) continue
            seen.add(href)
            normalized.push(href)
        }

        return normalized
    }

    function normalizeCoordinatorRequestedUrl(value = '') {
        const normalized = normalizeTabTargetUrl(`${value || ''}`.trim())
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

    function isProfileResolutionMode(value = '') {
        return `${value || ''}`.trim() === QUEUED_PROFILE_RESOLUTION_MODE
    }

    function isProfileResolutionItem(item = null) {
        return item?.resolveProfileFromPage === true ||
            isProfileResolutionMode(item?.resolutionMode || '') ||
            `${item?.coordinatorKey || item?.dedupeKey || item?.requestedUrl || ''}`.trim().startsWith('resolve-profile:')
    }

    function stripProfileResolutionQueueKey(key = '') {
        const value = `${key || ''}`.trim()
        return value.startsWith('resolve-profile:') ? value.slice('resolve-profile:'.length) : value
    }

    function makeProfileResolutionQueueKey(value = '') {
        const requestedUrl = normalizeCoordinatorRequestedUrl(stripProfileResolutionQueueKey(value))
        return requestedUrl ? `resolve-profile:${requestedUrl}` : ''
    }

    function getProfileResolutionRequestedUrl(item = null, fallbackKey = '') {
        return normalizeCoordinatorRequestedUrl(stripProfileResolutionQueueKey(
            item?.requestedUrl ||
            item?.dedupeKey ||
            item?.coordinatorKey ||
            fallbackKey ||
            ''
        ))
    }

    function getEncodedQuoraPathRootToken(value = '') {
        const token = `${value || ''}`.split(/[-_/]/).filter(Boolean)[0] || ''
        return token.toLowerCase()
    }

    function isEncodedProfilePathOrTruncatedProfilePath(value = '') {
        const rootToken = getEncodedQuoraPathRootToken(value)
        return rootToken.length >= 3 && 'profile'.startsWith(rootToken)
    }

    function isLowConfidenceEncodedQuestionPath(value = '') {
        const path = `${value || ''}`.replace(/^[-_/]+|[-_/]+$/g, '')
        if(path.length < 12) return true
        if(isEncodedProfilePathOrTruncatedProfilePath(path)) return true

        const rootToken = getEncodedQuoraPathRootToken(path)
        return QUORA_NON_PROFILE_ROOT_PATHS.has(rootToken)
    }

    function getQuestionResolutionUrlFromEvidencePostUrl(postUrl = '') {
        try {
            const url = new URL(`${postUrl || ''}`)
            const decodedPath = decodeURIComponent(url.pathname || '').replace(/^\/+/, '')
            const encodedQuoraUrlPattern = /(?:^|[-_/])https?-www-quora-com-([^/?#]+)/ig
            let match = null

            while((match = encodedQuoraUrlPattern.exec(decodedPath))) {
                const encodedPath = `${match[1] || ''}`.replace(/^[-_/]+|[-_/]+$/g, '')
                if(isLowConfidenceEncodedQuestionPath(encodedPath)) continue

                return normalizeCoordinatorRequestedUrl(`https://www.quora.com/${encodedPath}`)
            }
        }
        catch {
            return ''
        }

        return ''
    }

    function getInvalidProfileResolutionFailure(item = {}, fallbackKey = '') {
        if(!isProfileResolutionItem(item)) return ''

        const requestedUrl = getProfileResolutionRequestedUrl(item, fallbackKey)
        if(!requestedUrl) return 'Queued profile resolution has no source page'

        try {
            const url = new URL(requestedUrl)
            const hostname = `${url.hostname || ''}`.toLowerCase()
            const isPrimaryQuoraHost = hostname === 'quora.com' || hostname === 'www.quora.com'
            const isQuoraSubdomain = hostname.endsWith('.quora.com')
            if(!isPrimaryQuoraHost && !isQuoraSubdomain) {
                return `Queued profile resolution source is not a Quora page: ${requestedUrl}`
            }

            const pathParts = url.pathname.split('/').filter(Boolean)
            const rootToken = `${pathParts[0] || ''}`.toLowerCase()
            if(isQuoraSubdomain && !isPrimaryQuoraHost) return ''
            if(!rootToken) return `Queued profile resolution source is not a question page: ${requestedUrl}`
            if(rootToken.length >= 3 && 'profile'.startsWith(rootToken)) {
                return `Queued profile resolution source looks like a truncated profile URL: ${requestedUrl}`
            }
            if(QUORA_NON_PROFILE_ROOT_PATHS.has(rootToken)) {
                return `Queued profile resolution source is not a question page: ${requestedUrl}`
            }
        }
        catch {
            return `Queued profile resolution source is invalid: ${requestedUrl}`
        }

        return ''
    }

    function getCoordinatorItemQueueKey(item = null, fallbackKey = '') {
        const href = getCoordinatorItemHref(item || {})
        if(href) return href

        const explicitKey = `${item?.coordinatorKey || ''}`.trim()
        if(explicitKey) return explicitKey

        if(isProfileResolutionItem(item)) {
            return makeProfileResolutionQueueKey(item?.requestedUrl || item?.dedupeKey || fallbackKey || '')
        }

        return normalizeQuoraProfileUrl(fallbackKey || '') || `${fallbackKey || ''}`.trim()
    }

    function getCoordinatorItemOpenUrl(item = null, fallbackKey = '') {
        const href = getCoordinatorItemHref(item || {})
        if(href) return href
        if(isProfileResolutionItem(item) || `${fallbackKey || ''}`.trim().startsWith('resolve-profile:')) {
            return getProfileResolutionRequestedUrl(item, fallbackKey)
        }

        return normalizeTabTargetUrl(item?.requestedUrl || item?.dedupeKey || fallbackKey || '')
    }

    function makeCoordinatorScope(runInput = {}, source = {}, runId = '') {
        return {
            type: runInput.sourceType || source.type || 'space-feed',
            runId: runId || runInput.id || '',
            sourcePageUrl: source.pageUrl || runInput.sourcePageUrl || '',
            spaceKey: source.spaceKey || '',
            spaceCategory: source.spaceCategory || ''
        }
    }

    function makeCoordinatorResolutionSubject(requestedUrl = '', coordinatorKey = '') {
        const normalizedUrl = normalizeCoordinatorRequestedUrl(requestedUrl || stripProfileResolutionQueueKey(coordinatorKey || ''))
        if(!normalizedUrl) return null

        return {
            kind: 'quora-source-page',
            href: normalizedUrl,
            requestedUrl: normalizedUrl,
            aliases: coordinatorKey ? [coordinatorKey] : []
        }
    }

    function getCoordinatorSubjectKey(subject = null) {
        if(!subject || typeof subject !== 'object') return ''
        return `${subject.kind || 'subject'}:${subject.href || subject.requestedUrl || subject.key || ''}`
    }

    return {
        getFirstPositiveNumber,
        pruneProfileNukeProgress,
        mergeProfileProgressEvents,
        mergeUniqueStringList,
        getNormalizedProfileHrefList,
        normalizeCoordinatorRequestedUrl,
        isProfileResolutionMode,
        isProfileResolutionItem,
        stripProfileResolutionQueueKey,
        makeProfileResolutionQueueKey,
        getProfileResolutionRequestedUrl,
        getEncodedQuoraPathRootToken,
        isEncodedProfilePathOrTruncatedProfilePath,
        isLowConfidenceEncodedQuestionPath,
        getQuestionResolutionUrlFromEvidencePostUrl,
        getInvalidProfileResolutionFailure,
        getCoordinatorItemQueueKey,
        getCoordinatorItemOpenUrl,
        makeCoordinatorScope,
        makeCoordinatorResolutionSubject,
        getCoordinatorSubjectKey
    }
}

module.exports = {
    createProfileResolution
}
