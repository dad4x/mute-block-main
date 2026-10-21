// Coordinator job-key/envelope builders and diagnostic-event primitives
// extracted from sw.js (decomposition Slice 11, part 2 of 2). See the
// sibling swCoordinatorAttemptIdentity.js's header for why this 26-function
// slice was split into two modules rather than one.
//
// All 13 functions here are plain synchronous functions with no `async`
// keyword and no Promise/`.then()`/`.catch()` chain in their bodies (grepped
// every body before moving, per architecture.md's "Module Extraction And
// The Test Harness Realm Boundary" section, "Refinement found during ...
// Slice 7" paragraph) -- none of them carry any realm-crossing risk either
// direction. buildQueuedCoordinatorProgressResetPatch,
// makeStaleAttemptDiagnosticEvent, and recordCoordinatorDiagnosticEvent all
// read `Date.now()` for a timestamp that IS compared/ordered elsewhere
// (queuedAt/at fields the reconcile core and tests reason about under fake
// timers), so per the plan's clock/environment-global note all three get
// `now: () => Date.now()` threaded through deps.
//
// Ordering vs. swCoordinatorAttemptIdentity.js: this module depends on that
// one's makeId, normalizeAttemptId, getAttemptIdFromValue, and
// getAttemptNumberFromValue (threaded through as handler deps), so it must
// be constructed after it.
// It also needs storageUpdateState (for recordCoordinatorDiagnosticEvent's
// depth check) and profileResolution's exports (isProfileResolutionItem,
// getProfileResolutionRequestedUrl, normalizeCoordinatorRequestedUrl,
// getQuestionResolutionUrlFromEvidencePostUrl, getNormalizedProfileHrefList,
// makeCoordinatorScope, makeCoordinatorResolutionSubject,
// getCoordinatorSubjectKey), both already available well before this
// module's earliest eager dependent. That dependent is
// queuedTabRuntimeStatus (old line ~1675), which references
// applyCoordinatorJobEnvelope eagerly at construction time -- a hoisted
// `function` declaration is visible throughout its whole scope, but a
// `const` destructured from a factory call is in the temporal dead zone
// until that line executes, so this module is constructed in sw.js right
// after storageUpdateState exists and before activationGuardRuntime /
// queuedTabRuntimeStatus, rather than at this cluster's old (much later)
// source-text position.
//
// getCoordinatorActionKindForRequestedAction, getCoordinatorItemHref,
// isTerminalCoordinatorStatus, and cloneCoordinatorAuthorityValue all stay
// in sw.js as plain hoisted function declarations (untouched by this
// slice) and are threaded through as handler deps -- hoisted declarations
// are visible from anywhere in their enclosing scope regardless of textual
// position, so no TDZ concern on their side. pendingCoordinatorDiagnosticEvents
// and coordinatorDiagnosticBatchDepth are module-level mutable state in
// sw.js also read/written directly by recordStaleAttemptDiagnostic (an
// async function staying in sw.js, out of this slice's scope) -- threaded
// through as get/set state accessors here, matching the
// swQueueWakeupMetricsShape.js convention, rather than moved.

const {coordinatorEventToFlightRecorderEntry} = require('./coordinatorEventRecord')

function createCoordinatorJobEnvelope(deps = {}) {
    const now = typeof deps.now === 'function' ? deps.now : () => Date.now()
    const {
        MAX_COORDINATOR_EVENTS,
        STALE_QUEUED_TAB_MAX_RETRIES,
        UNBLOCK_UNMUTE_ACTION_KIND
    } = deps.constants || {}
    const {
        normalizeQuoraProfileUrl,
        makeCanonicalSubject,
        getCoordinatorActionKindForRequestedAction,
        getCoordinatorItemHref,
        isTerminalCoordinatorStatus,
        cloneCoordinatorAuthorityValue,
        isProfileResolutionItem,
        getProfileResolutionRequestedUrl,
        normalizeCoordinatorRequestedUrl,
        getQuestionResolutionUrlFromEvidencePostUrl,
        getNormalizedProfileHrefList,
        makeCoordinatorScope,
        makeCoordinatorResolutionSubject,
        getCoordinatorSubjectKey,
        makeId,
        normalizeAttemptId,
        getAttemptIdFromValue,
        getAttemptNumberFromValue,
        incrementQueueWakeupMetric,
        recordQueueWakeupMetricMax,
        recordFlightRecorderEvent,
        getStorageUpdateDepth,
        getQueueRuntimeCounts
    } = deps.handlers || {}
    const {
        getPendingCoordinatorDiagnosticEvents,
        setPendingCoordinatorDiagnosticEvents,
        getCoordinatorDiagnosticBatchDepth
    } = deps.state || {}

    function makeCoordinatorJobKey(scope = {}, actionKind = '', subject = null) {
        const scopeKey = scope.runId ||
            [scope.type || 'global', scope.sourcePageUrl || scope.spaceKey || ''].filter(Boolean).join(':') ||
            'global'
        const subjectKey = getCoordinatorSubjectKey(subject)
        if(!subjectKey) return ''

        return `${scopeKey}|${getCoordinatorActionKindForRequestedAction(actionKind)}|${subjectKey}`
    }

    function makeCoordinatorAttemptEnvelope(existing = null, attemptId = '', attemptNumber = 0, maxAttempts = 1) {
        const previous = existing?.attempt && typeof existing.attempt === 'object' ? existing.attempt : {}
        return {
            ...previous,
            id: normalizeAttemptId(attemptId || previous.id || ''),
            number: Number.parseInt(attemptNumber || previous.number, 10) || 0,
            max: Number.parseInt(maxAttempts || previous.max, 10) || 1,
            claimedTabId: previous.claimedTabId ?? existing?.tabId ?? null,
            claimedAt: Number.parseInt(previous.claimedAt, 10) || 0,
            leaseExpiresAt: Number.parseInt(previous.leaseExpiresAt, 10) || 0,
            heartbeatAt: Number.parseInt(previous.heartbeatAt, 10) || 0
        }
    }

    function makeCoordinatorJobEnvelope(details = {}) {
        const targetProfileHref = normalizeQuoraProfileUrl(details.targetProfileHref || '')
        const coordinatorKey = `${details.coordinatorKey || targetProfileHref || ''}`.trim()
        const requestedUrl = isProfileResolutionItem({
                requestedUrl: details.requestedUrl || '',
                coordinatorKey
            })
            ? getProfileResolutionRequestedUrl({
                requestedUrl: details.requestedUrl || '',
                coordinatorKey
            }, coordinatorKey)
            : normalizeCoordinatorRequestedUrl(details.requestedUrl || targetProfileHref || coordinatorKey)
        const actionKind = getCoordinatorActionKindForRequestedAction(details.actionKind || '')
        const scope = makeCoordinatorScope(details.runInput || {}, details.source || {}, details.runId || '')
        const canonicalSubject = targetProfileHref
            ? makeCanonicalSubject(targetProfileHref)
            : makeCoordinatorResolutionSubject(requestedUrl, coordinatorKey)
        const jobKey = makeCoordinatorJobKey(scope, actionKind, canonicalSubject)

        return {
            jobKey,
            scope,
            canonicalSubject
        }
    }

    function applyCoordinatorJobEnvelope(item = {}, details = {}) {
        const envelope = makeCoordinatorJobEnvelope({
            targetProfileHref: item.targetProfileHref || details.targetProfileHref || '',
            requestedUrl: item.requestedUrl || details.requestedUrl || '',
            coordinatorKey: item.coordinatorKey || details.coordinatorKey || '',
            actionKind: item.actionKind || details.actionKind || '',
            runInput: details.runInput || {},
            source: item.source || details.source || {},
            runId: item.runId || details.runId || ''
        })

        return {
            ...item,
            jobKey: envelope.jobKey || item.jobKey || '',
            scope: envelope.scope || item.scope,
            canonicalSubject: envelope.canonicalSubject || item.canonicalSubject,
            attempt: makeCoordinatorAttemptEnvelope(
                item,
                getAttemptIdFromValue(item),
                getAttemptNumberFromValue(item),
                item.maxAttempts || item.attempt?.max || 1
            )
        }
    }

    function getFailedItemQuestionResolutionUrl(item = {}) {
        const errorText = `${item?.error || ''}`
        const questionPathMatch = errorText.match(/\bquestion:\s*(\/[^)\s]+)/i)
        if(questionPathMatch?.[1]) {
            return normalizeCoordinatorRequestedUrl(`https://www.quora.com${questionPathMatch[1]}`)
        }

        const evidence = Array.isArray(item?.evidence) ? item.evidence : []
        for(const entry of evidence) {
            try {
                const requestedUrl = getQuestionResolutionUrlFromEvidencePostUrl(entry?.postUrl || '')
                if(requestedUrl) return requestedUrl
            }
            catch {}
        }

        if(/\bdid not land on a profile page\b/i.test(errorText)) {
            for(const entry of evidence) {
                const postUrl = normalizeCoordinatorRequestedUrl(entry?.postUrl || '')
                if(postUrl) return postUrl
            }
        }

        return ''
    }

    function getFailedItemProfileResolutionRetryUrl(item = {}, fallbackKey = '') {
        // Review 5 (R5-4), owner rule: a row that is not a resolution and has its own link is never retried as a resolution from
        // its source post, because the post would choose the profile. A "did not land" error carries the post URL, so without this
        // a canonical row could block a profile picked from its post.
        if(!isProfileResolutionItem(item) && getCoordinatorItemHref(item)) return ''

        const fallbackResolutionUrl = getFailedItemQuestionResolutionUrl(item)
        if(fallbackResolutionUrl) return fallbackResolutionUrl

        if(!isProfileResolutionItem(item)) return ''
        if(getCoordinatorItemHref(item)) return ''

        return getProfileResolutionRequestedUrl(item, fallbackKey)
    }

    function buildQueuedCoordinatorProgressResetPatch(item = {}, options = {}) {
        const actionKind = getCoordinatorActionKindForRequestedAction(item?.actionKind || options.actionKind || '')
        const nowMs = Number.parseInt(options.now, 10) || now()

        return {
            replaceProgressRecord: true,
            actionKind,
            runId: item?.runId || options.runId || '',
            attemptId: getAttemptIdFromValue(item),
            attemptNumber: getAttemptNumberFromValue(item),
            status: 'queued',
            queuedAt: nowMs,
            queueIndex: 0,
            retryAttempt: 0,
            maxRetries: Number.parseInt(item?.maxRetries, 10) || STALE_QUEUED_TAB_MAX_RETRIES,
            tabId: null,
            tabCreatedAt: 0,
            tabOpenedAt: 0,
            contentOpenedAt: 0,
            actionReadyAt: 0,
            openedViablePage: false,
            terminalAt: 0,
            slotReleasedAt: 0,
            closeRequestedAt: 0,
            tabClosedAt: 0,
            closedByExtension: false,
            closeReason: '',
            ownerTabId: null,
            ownerWindowId: null,
            waitingForForegroundAt: 0,
            foregroundWaitReason: '',
            foregroundWaitLastEventAt: 0,
            foregroundLeaseAcquiredAt: 0,
            foregroundPromotedAt: 0,
            foregroundPromotionReason: '',
            muteAttempted: false,
            muteSucceeded: false,
            muteAttemptedAt: 0,
            mutedAt: 0,
            muteError: '',
            blockAttempted: false,
            blockSucceeded: false,
            blockAttemptedAt: 0,
            blockedAt: 0,
            blockError: '',
            directBlockFailureDetail: null,
            unblockOk: false,
            unblockSucceeded: false,
            unblockReason: '',
            unmuteOk: false,
            unmuteReason: '',
            foundBlockedBeforeQueue: false,
            profileBlocked: false,
            profileMenuOpen: false,
            selectedActionLabel: '',
            selectedActionRect: null,
            menuActionLabels: [],
            visibleProfileMenuLabels: [],
            finalError: '',
            errorPageUrl: '',
            lastUrl: '',
            unavailableReason: '',
            resolvedProfileHref: '',
            remappedFromRequested: false,
            securityVerification: false,
            event: actionKind === UNBLOCK_UNMUTE_ACTION_KIND
                ? 'Added Unblock Unmute to Current Work'
                : 'Added Mute Block to Current Work'
        }
    }

    function getStoredSpaceFeedRecordUrls(record, key = 'remainingUrls') {
        if(!record || typeof record !== 'object') return []

        const urls = key && Array.isArray(record[key])
            ? record[key]
            : key === 'remainingUrls'
                ? Array.isArray(record.remainingUrls)
                    ? record.remainingUrls
                    : Array.isArray(record.allUrls)
                        ? record.allUrls
                        : Array.isArray(record.urls)
                            ? record.urls
                            : []
                : []

        return getNormalizedProfileHrefList(urls)
    }

    function getPendingSpaceFeedJobKeyPatch(record = {}, remainingUrls = []) {
        const remaining = getNormalizedProfileHrefList(remainingUrls)
        const existingByHref = record?.jobKeysByProfileHref && typeof record.jobKeysByProfileHref === 'object'
            ? record.jobKeysByProfileHref
            : {}
        const jobKeysByProfileHref = {}

        for(const href of remaining) {
            jobKeysByProfileHref[href] = normalizeQuoraProfileUrl(existingByHref[href] || href) || href
        }

        return {
            jobKeys: getNormalizedProfileHrefList(Object.values(jobKeysByProfileHref)),
            jobKeysByProfileHref
        }
    }

    function makeStaleAttemptDiagnosticEvent(details = {}) {
        return {
            id: makeId('event'),
            runId: details.runId || '',
            itemId: details.itemId || '',
            type: 'stale-attempt',
            message: details.message || 'Ignored stale worker attempt',
            at: now(),
            details: {
                profileHref: details.profileHref || '',
                incomingAttemptId: details.incomingAttemptId || '',
                expectedAttemptId: details.expectedAttemptId || '',
                senderTabId: details.senderTabId || null
            }
        }
    }

    function recordCoordinatorDiagnosticEvent(type = 'coordinator-diagnostic', message = '', details = {}) {
        const event = {
            type: `${type || 'coordinator-diagnostic'}`.trim() || 'coordinator-diagnostic',
            runId: details?.runId || '',
            itemId: details?.itemId || '',
            message: `${message || 'Coordinator diagnostic event'}`.slice(0, 500),
            at: now(),
            details: details && typeof details === 'object'
                ? cloneCoordinatorAuthorityValue(details)
                : {}
        }
        incrementQueueWakeupMetric('diagnosticEvent.received')
        recordFlightRecorderEvent(coordinatorEventToFlightRecorderEntry(event))
        return true
    }

    function drainPendingCoordinatorDiagnosticEvents() {
        const events = getPendingCoordinatorDiagnosticEvents()
        setPendingCoordinatorDiagnosticEvents([])
        return events
    }

    function shouldFlushPendingCoordinatorDiagnosticEventsNow(context = {}) {
        const durableActiveRows = Number.parseInt(context?.durableActiveRows, 10) || 0
        const durableQueuedRows = Number.parseInt(context?.durableQueuedRows, 10) || 0
        const runtimeCounts = getQueueRuntimeCounts()
        return runtimeCounts.activeQueuedTabs <= 0 &&
            runtimeCounts.queuedTabActions <= 0 &&
            runtimeCounts.pendingTabActions <= 0 &&
            durableActiveRows <= 0 &&
            durableQueuedRows <= 0
    }

    return {
        makeCoordinatorJobKey,
        makeCoordinatorAttemptEnvelope,
        makeCoordinatorJobEnvelope,
        applyCoordinatorJobEnvelope,
        getFailedItemQuestionResolutionUrl,
        getFailedItemProfileResolutionRetryUrl,
        buildQueuedCoordinatorProgressResetPatch,
        getStoredSpaceFeedRecordUrls,
        getPendingSpaceFeedJobKeyPatch,
        makeStaleAttemptDiagnosticEvent,
        recordCoordinatorDiagnosticEvent,
        drainPendingCoordinatorDiagnosticEvents,
        shouldFlushPendingCoordinatorDiagnosticEventsNow
    }
}

module.exports = {
    createCoordinatorJobEnvelope
}
