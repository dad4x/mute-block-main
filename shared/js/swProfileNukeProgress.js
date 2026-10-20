// Profile-nuke-progress sharding/view functions extracted from sw.js
// (decomposition Slice 15). This is the per-profile progress record
// shape/summarization layer plus its sharded storage view: the record
// summarizer, the compact progress view builder, the shard index/key
// helpers, the shard-defaults builders, the projection-defaults builder,
// the shard payload builder, the content-page projection filter (a queued
// profile or a terminal record keeps its progress), the stored-projection
// content comparison the door's progress repair uses to write only the keys
// that changed, the view/shard record update and removal helpers, the
// shard-records normalizer, the
// records-from-projection getter, and the content-page-state projection
// payload assembler (which composes this module's own state with
// swCoordinatorQueueView.js's and swCoordinatorContentQueueIndex.js's
// builders).
//
// Construction-order note: nothing already constructed earlier in sw.js
// eagerly references any of these 18 function names in its own deps object
// literal (checked via grep across every `create*(` call site before this
// cluster's old source-text position), and nothing constructed after this
// point in sw.js does either -- so this module constructs in place at the
// cluster's old position, immediately after swCoordinatorContentQueueIndex.js,
// matching the Slice 14 precedent.
//
// Every body was grepped for `.then(`, `.catch(`, `Promise.`, `async`, and
// `setTimeout` before moving. None of these 18 functions has any of these,
// so no realm-crossing risk for this module.
//
// Two functions from the plan's Slice 15 list -- scheduleTerminalProgressProjectionFlush
// and saveTerminalProgressProjectionAfterAuthority -- are deliberately left
// behind in sw.js. Despite being non-`async`, scheduleTerminalProgressProjectionFlush
// builds a `Promise.resolve().then()` chain that calls the async, sw.js-resident
// flushTerminalProgressProjectionSaves (itself out of scope for this sync-only
// decomposition, per the plan's "Boundary after Slice 17" section) and
// recursively re-schedules itself from inside that chain's `.finally()`. Moving
// it into this module would newly cross the vm-sandboxed/require() realm
// boundary on every flush cycle -- calling back into sw.js's async function,
// then continuing the chain from this module -- exactly the shape the Slice 7
// refinement in architecture.md warns can silently reorder concurrent
// reconcile-tick work with no logic difference in the moved code. Both
// functions also share three module-level mutable bindings
// (terminalProgressProjectionSaveScheduled, terminalProgressProjectionSavePromise,
// terminalProgressProjectionSaveBatches) used by no other code, which would
// need getter/setter deps threading beyond mechanical substitution to move
// cleanly. Left in sw.js per the plan's guidance that leaving 1-2 functions
// behind is an acceptable outcome (matching Slices 7 and 9).
//
// Clock note: buildProfileNukeProgressView, buildProfileNukeProgressShardPayload,
// updateProfileNukeProgressViewRecords, updateProfileNukeProgressShardRecord,
// removeProfileNukeProgressViewRecords, and removeProfileNukeProgressShardRecords
// all read Date.now() via a default parameter (`now = Date.now()`), which
// evaluates in the *defining* function's own realm when the caller omits the
// argument, not the caller's -- per the Slice 2/12/13/14 clock-note precedent.
// `now` is threaded through this module's deps as `() => Date.now()` and each
// default parameter reads `now()` instead.
//
// cloneCoordinatorAuthorityValue and the createCoordinatorAuthority-adjacent
// region are explicitly out of scope for this decomposition effort (see the
// plan's "Boundary after Slice 17" section) and are untouched here.

function createProfileNukeProgress(deps = {}) {
    const {now} = deps
    const {
        normalizeQuoraProfileUrl,
        getAttemptIdFromValue,
        getAttemptNumberFromValue,
        normalizeStoredProfileNukeProgress,
        hashProjectionShardKey,
        getProjectionShardKeyByIndex,
        getProjectionShardKey,
        getNormalizedProfileHrefList,
        makeProjectionShardDefaults,
        isTerminalCoordinatorStatus,
        isTerminalProfileNukeRecord,
        getCoordinatorItemHref,
        normalizeProfileNukeProgressView,
        normalizeCoordinatorMap,
        makeCoordinatorQueueWalCheckpoint,
        buildCoordinatorQueueView
    } = deps.handlers || {}
    const {
        MAX_PROFILE_NUKE_PROGRESS_VIEW_RECORDS,
        PROFILE_NUKE_PROGRESS_SHARD_COUNT,
        PROFILE_NUKE_PROGRESS_SHARD_PREFIX,
        PROFILE_NUKE_PROGRESS_VIEW_KEY,
        COORDINATOR_QUEUE_KEY,
        COORDINATOR_QUEUE_WAL_KEY,
        COORDINATOR_QUEUE_VIEW_KEY
    } = deps.constants || {}

    function summarizeProfileNukeProgressRecord(profileHref = '', record = {}) {
        const href = normalizeQuoraProfileUrl(record?.profileHref || profileHref || '')
        if(!href) return null

        const source = record && typeof record === 'object' ? record : {}
        const generation = Number.parseInt(source.generation, 10) || 0
        return {
            profileHref: href,
            status: source.status || '',
            actionKind: source.actionKind || '',
            attemptId: getAttemptIdFromValue(source),
            attemptNumber: getAttemptNumberFromValue(source),
            runId: source.runId || '',
            tabId: Number.isFinite(source.tabId) ? source.tabId : source.tabId || null,
            lastUrl: source.lastUrl || '',
            queuedAt: Number.parseInt(source.queuedAt, 10) || 0,
            tabCreatedAt: Number.parseInt(source.tabCreatedAt, 10) || 0,
            tabOpenedAt: Number.parseInt(source.tabOpenedAt, 10) || 0,
            contentOpenedAt: Number.parseInt(source.contentOpenedAt, 10) || 0,
            actionReadyAt: Number.parseInt(source.actionReadyAt, 10) || 0,
            waitingForForegroundAt: Number.parseInt(source.waitingForForegroundAt, 10) || 0,
            foregroundLeaseAcquiredAt: Number.parseInt(source.foregroundLeaseAcquiredAt, 10) || 0,
            foregroundPromotedAt: Number.parseInt(source.foregroundPromotedAt, 10) || 0,
            muteAttemptedAt: Number.parseInt(source.muteAttemptedAt, 10) || 0,
            blockAttemptedAt: Number.parseInt(source.blockAttemptedAt, 10) || 0,
            unmuteAttemptedAt: Number.parseInt(source.unmuteAttemptedAt, 10) || 0,
            unblockAttemptedAt: Number.parseInt(source.unblockAttemptedAt, 10) || 0,
            terminalAt: Number.parseInt(source.terminalAt, 10) || 0,
            updatedAt: Number.parseInt(source.updatedAt, 10) || 0,
            actionSurfaceMode: source.actionSurfaceMode || '',
            actionSurfaceWindowId: source.actionSurfaceWindowId || null,
            actionSurfaceAnchorTabId: source.actionSurfaceAnchorTabId || null,
            actionSurfaceActivatedAt: Number.parseInt(source.actionSurfaceActivatedAt, 10) || 0,
            muteSucceeded: source.muteSucceeded === true,
            blockSucceeded: source.blockSucceeded === true,
            unblockSucceeded: source.unblockSucceeded === true,
            unmuteSucceeded: source.unmuteSucceeded === true,
            foundBlockedBeforeQueue: source.foundBlockedBeforeQueue === true,
            finalError: source.finalError || '',
            muteError: source.muteError || '',
            blockError: source.blockError || '',
            directBlockFailureDetail: source.directBlockFailureDetail &&
                typeof source.directBlockFailureDetail === 'object'
                ? source.directBlockFailureDetail
                : null,
            unblockReason: source.unblockReason || '',
            unmuteReason: source.unmuteReason || '',
            unavailableReason: source.unavailableReason || '',
            resolvedProfileHref: source.resolvedProfileHref || '',
            remappedFromRequested: source.remappedFromRequested === true,
            closeReason: source.closeReason || '',
            errorPageUrl: source.errorPageUrl || '',
            securityVerificationUrl: source.securityVerificationUrl || '',
            // Both purely bookkeeping for recordDirectProfileProgressFromRequest's
            // out-of-order/stale-write guard (sw.js) -- clearedAt marks a row
            // clearProfileNukeState tombstoned rather than deleted, and
            // directProgressClientUpdatedAt is the client-origination
            // timestamp that guard compares against. Neither must be
            // dropped here, or the guard loses its stored basis for
            // comparison across a service-worker restart.
            clearedAt: Number.parseInt(source.clearedAt, 10) || 0,
            directProgressClientUpdatedAt: Number.parseInt(source.directProgressClientUpdatedAt, 10) || 0,
            // Set by the write door on every upsert (sw.js applyCoordinatorProgressDeltas). Kept in both the view
            // entry and the shard entry. Records written before generations existed have none, so the key is left
            // out rather than written as 0.
            ...(generation > 0 ? {generation} : {})
        }
    }

    function buildProfileNukeProgressView(progress = {}, nowMs = now()) {
        const normalized = normalizeStoredProfileNukeProgress(progress || {})
        const entries = Object.entries(normalized)
            .sort((left, right) => {
                const leftUpdatedAt = Number.parseInt(left[1]?.updatedAt, 10) || 0
                const rightUpdatedAt = Number.parseInt(right[1]?.updatedAt, 10) || 0
                return rightUpdatedAt - leftUpdatedAt || left[0].localeCompare(right[0])
            })
        const records = {}
        for(const [profileHref, record] of entries.slice(0, MAX_PROFILE_NUKE_PROGRESS_VIEW_RECORDS)) {
            const summary = summarizeProfileNukeProgressRecord(profileHref, record)
            if(summary) records[summary.profileHref] = summary
        }

        return {
            version: 2,
            updatedAt: nowMs,
            total: entries.length,
            recordLimit: MAX_PROFILE_NUKE_PROGRESS_VIEW_RECORDS,
            truncated: entries.length > Object.keys(records).length,
            records
        }
    }

    function getProfileNukeProgressShardIndex(profileHref = '') {
        const href = normalizeQuoraProfileUrl(profileHref)
        return hashProjectionShardKey(href, PROFILE_NUKE_PROGRESS_SHARD_COUNT)
    }

    function getProfileNukeProgressShardKeyByIndex(index = 0) {
        return getProjectionShardKeyByIndex(
            PROFILE_NUKE_PROGRESS_SHARD_PREFIX,
            PROFILE_NUKE_PROGRESS_SHARD_COUNT,
            index
        )
    }

    function getProfileNukeProgressShardKey(profileHref = '') {
        return getProjectionShardKey(
            PROFILE_NUKE_PROGRESS_SHARD_PREFIX,
            PROFILE_NUKE_PROGRESS_SHARD_COUNT,
            normalizeQuoraProfileUrl(profileHref)
        )
    }

    function getProfileNukeProgressShardDefaults(profileHrefs = []) {
        const defaults = {}
        for(const href of getNormalizedProfileHrefList(profileHrefs || [])) {
            const key = getProfileNukeProgressShardKey(href)
            if(key) defaults[key] = {}
        }
        return defaults
    }

    function getAllProfileNukeProgressShardDefaults() {
        return makeProjectionShardDefaults(
            PROFILE_NUKE_PROGRESS_SHARD_PREFIX,
            PROFILE_NUKE_PROGRESS_SHARD_COUNT
        )
    }

    function getProfileNukeProgressProjectionDefaults(profileHrefs = [], options = {}) {
        const hrefs = getNormalizedProfileHrefList(profileHrefs || [])
        const includeView = options.includeView !== false
        return {
            ...(includeView ? {[PROFILE_NUKE_PROGRESS_VIEW_KEY]: null} : {}),
            ...(hrefs.length
                ? getProfileNukeProgressShardDefaults(hrefs)
                : getAllProfileNukeProgressShardDefaults())
        }
    }

    function buildProfileNukeProgressShardPayload(progress = {}, nowMs = now()) {
        const normalized = normalizeStoredProfileNukeProgress(progress || {})
        const shards = {}
        for(let index = 0; index < PROFILE_NUKE_PROGRESS_SHARD_COUNT; index += 1) {
            shards[getProfileNukeProgressShardKeyByIndex(index)] = {
                version: 1,
                updatedAt: nowMs,
                records: {}
            }
        }

        for(const [profileHref, record] of Object.entries(normalized)) {
            const key = getProfileNukeProgressShardKey(profileHref)
            if(!key) continue
            const summary = summarizeProfileNukeProgressRecord(profileHref, record)
            if(summary) shards[key].records[summary.profileHref] = summary
        }

        return shards
    }

    function hasNonterminalCoordinatorAuthorityForProfile(queue = {}, profileHref = '') {
        const href = normalizeQuoraProfileUrl(profileHref)
        if(!href) return false

        return Object.entries(queue || {}).some(([itemKey, item]) => {
            if(!item || typeof item !== 'object') return false
            if(isTerminalCoordinatorStatus(item.status)) return false
            const itemHref = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(itemKey)
            return itemHref === href
        })
    }

    // A record is kept when its profile is queued (hasNonterminalCoordinatorAuthorityForProfile: a nonterminal queue row)
    // or when the record itself is terminal (isTerminalProfileNukeRecord, the record-level predicate). Any other record,
    // for example an in-flight action for a profile that is not queued, is dropped.
    function filterProfileNukeProgressForContentProjection(progress = {}, queue = {}) {
        const normalized = normalizeStoredProfileNukeProgress(progress || {})
        const filtered = {}
        for(const [profileHref, record] of Object.entries(normalized)) {
            if(!hasNonterminalCoordinatorAuthorityForProfile(queue, profileHref) &&
                !isTerminalProfileNukeRecord(record)) continue
            filtered[profileHref] = record
        }
        return filtered
    }

    // Canonical JSON for comparing projection values: object keys sorted at every depth, undefined members left out, so
    // two values with the same content give the same string whatever their key order.
    function stableProfileNukeProgressProjectionJson(value) {
        if(Array.isArray(value)) return `[${value.map(stableProfileNukeProgressProjectionJson).join(',')}]`
        if(value && typeof value === 'object') {
            return `{${Object.keys(value)
                .filter(key => value[key] !== undefined)
                .sort()
                .map(key => `${JSON.stringify(key)}:${stableProfileNukeProgressProjectionJson(value[key])}`)
                .join(',')}}`
        }
        return JSON.stringify(value === undefined ? null : value)
    }

    // The content of a progress view or shard: its own updatedAt and each record's updatedAt are left out. A timestamp is
    // not content. normalizeStoredProfileNukeProgress (swProfileProgressMerge.js) sets every record's updatedAt to now(),
    // so a derived value always carries new timestamps and could never equal the stored one.
    function getProfileNukeProgressProjectionContent(value) {
        if(!value || typeof value !== 'object' || Array.isArray(value)) return value
        const content = {...value}
        delete content.updatedAt
        if(content.records && typeof content.records === 'object' && !Array.isArray(content.records)) {
            content.records = Object.fromEntries(Object.entries(content.records).map(([profileHref, record]) => {
                if(!record || typeof record !== 'object' || Array.isArray(record)) return [profileHref, record]
                const recordContent = {...record}
                delete recordContent.updatedAt
                return [profileHref, recordContent]
            }))
        }
        return content
    }

    // The keys of derived (a progress view and the shard payload, as buildProfileNukeProgressView and
    // buildProfileNukeProgressShardPayload build them) whose content differs from stored[key]. A missing stored value
    // differs from every derived value. Timestamps are ignored (getProfileNukeProgressProjectionContent).
    function getChangedProfileNukeProgressProjectionKeys(stored = {}, derived = {}) {
        return Object.keys(derived || {}).filter(key =>
            stableProfileNukeProgressProjectionJson(getProfileNukeProgressProjectionContent(stored?.[key])) !==
            stableProfileNukeProgressProjectionJson(getProfileNukeProgressProjectionContent(derived[key])))
    }

    function updateProfileNukeProgressViewRecords(view = null, progressRecords = {}, nowMs = now()) {
        const current = normalizeProfileNukeProgressView(view)
        const records = {
            ...current.records
        }
        const previousCount = Object.keys(records).length

        for(const [profileHref, record] of Object.entries(progressRecords || {})) {
            const summary = summarizeProfileNukeProgressRecord(profileHref, record)
            if(summary) records[summary.profileHref] = summary
        }

        const recordLimit = Number.parseInt(current.recordLimit, 10) || MAX_PROFILE_NUKE_PROGRESS_VIEW_RECORDS
        const entries = Object.entries(records)
            .sort((left, right) => {
                const leftUpdatedAt = Number.parseInt(left[1]?.updatedAt, 10) || 0
                const rightUpdatedAt = Number.parseInt(right[1]?.updatedAt, 10) || 0
                return rightUpdatedAt - leftUpdatedAt || left[0].localeCompare(right[0])
            })
        const capped = Object.fromEntries(entries.slice(0, recordLimit))
        const knownTotal = Number.parseInt(current.total, 10) || previousCount
        const total = Math.max(knownTotal, Object.keys(records).length)

        return {
            version: 2,
            updatedAt: nowMs,
            total,
            recordLimit,
            truncated: total > Object.keys(capped).length || entries.length > Object.keys(capped).length,
            records: capped
        }
    }

    function updateProfileNukeProgressShardRecord(shard = null, profileHref = '', record = null, nowMs = now()) {
        const href = normalizeQuoraProfileUrl(record?.profileHref || profileHref || '')
        const summary = summarizeProfileNukeProgressRecord(href, record)
        const records = normalizeProfileNukeProgressShardRecords({current: shard})
        if(summary) records[summary.profileHref] = summary

        return {
            version: 1,
            updatedAt: nowMs,
            records
        }
    }

    function removeProfileNukeProgressViewRecords(view = null, profileHrefs = [], knownRemovedCount = 0, nowMs = now()) {
        const current = normalizeProfileNukeProgressView(view)
        const records = {
            ...current.records
        }
        for(const href of getNormalizedProfileHrefList(profileHrefs || [])) {
            delete records[href]
        }

        const recordLimit = Number.parseInt(current.recordLimit, 10) || MAX_PROFILE_NUKE_PROGRESS_VIEW_RECORDS
        const entries = Object.entries(records)
            .sort((left, right) => {
                const leftUpdatedAt = Number.parseInt(left[1]?.updatedAt, 10) || 0
                const rightUpdatedAt = Number.parseInt(right[1]?.updatedAt, 10) || 0
                return rightUpdatedAt - leftUpdatedAt || left[0].localeCompare(`${right[0]}`)
            })
        const capped = Object.fromEntries(entries.slice(0, recordLimit))
        const currentTotal = Number.parseInt(current.total, 10) || Object.keys(current.records).length
        const total = Math.max(0, currentTotal - Math.max(0, Number.parseInt(knownRemovedCount, 10) || 0))

        return {
            version: 2,
            updatedAt: nowMs,
            total,
            recordLimit,
            truncated: total > Object.keys(capped).length || entries.length > Object.keys(capped).length,
            records: capped
        }
    }

    function removeProfileNukeProgressShardRecords(shard = null, profileHrefs = [], nowMs = now()) {
        const records = normalizeProfileNukeProgressShardRecords({current: shard})
        for(const href of getNormalizedProfileHrefList(profileHrefs || [])) {
            delete records[href]
        }

        return {
            version: 1,
            updatedAt: nowMs,
            records
        }
    }

    function normalizeProfileNukeProgressShardRecords(shards = {}) {
        const records = {}
        for(const shard of Object.values(shards || {})) {
            const shardRecords = shard && typeof shard === 'object' && shard.records && typeof shard.records === 'object'
                ? shard.records
                : {}
            Object.assign(records, normalizeStoredProfileNukeProgress(shardRecords))
        }
        return records
    }

    function getProfileNukeProgressRecordsFromProjection(stored = {}, profileHrefs = [], options = {}) {
        const hrefs = getNormalizedProfileHrefList(profileHrefs || [])
        const requested = hrefs.length ? new Set(hrefs) : null
        const viewRecords = options.includeView === false
            ? {}
            : normalizeProfileNukeProgressView(stored?.[PROFILE_NUKE_PROGRESS_VIEW_KEY]).records
        const shardDefaults = requested
            ? getProfileNukeProgressShardDefaults(hrefs)
            : getAllProfileNukeProgressShardDefaults()
        const shardRecords = normalizeProfileNukeProgressShardRecords(
            Object.fromEntries(Object.keys(shardDefaults).map(key => [key, stored?.[key]]))
        )
        const progress = {}
        for(const [profileHref, record] of Object.entries({
            ...viewRecords,
            ...shardRecords
        })) {
            if(!requested || requested.has(profileHref)) progress[profileHref] = record
        }
        return progress
    }

    function addContentPageStateProjectionPayload(payload = {}) {
        if(!payload || typeof payload !== 'object') return payload
        const next = {
            ...payload
        }
        const nowMs = now()
        if(
            Object.prototype.hasOwnProperty.call(next, COORDINATOR_QUEUE_KEY) &&
            next[COORDINATOR_QUEUE_KEY] &&
            typeof next[COORDINATOR_QUEUE_KEY] === 'object'
        ) {
            const queue = normalizeCoordinatorMap(next[COORDINATOR_QUEUE_KEY])
            if(!Object.prototype.hasOwnProperty.call(next, COORDINATOR_QUEUE_WAL_KEY)) {
                next[COORDINATOR_QUEUE_WAL_KEY] = makeCoordinatorQueueWalCheckpoint(queue, {createdAt: nowMs})
            }
            // 2026-10-02: used to also inject a freshly-built
            // COORDINATOR_QUEUE_VIEW_KEY here unconditionally on every full-
            // queue write -- missed during the 2026-10-01 "remove all on-disk
            // mbCoordinatorQueueView persistence" work (this call site isn't
            // near any of the other projection-payload builders that work
            // touched). That kept the disk key perpetually re-populated with
            // whatever queue shape happened to be writing at that moment --
            // not the ratcheted/statsClearedAt-filtered view the rest of the
            // app expects -- which the WAL's auto-recovery-from-view path
            // (since retired -- see LEGACY_QUEUE_VIEW_RETIREMENT.md) then read back
            // in as "the truth" on the next hydrate failure, reintroducing
            // old/mismatched row states on top of a live WAL that had since
            // moved on. Confirmed live: reappearing rows and up to 3
            // concurrently active tabs right after a
            // coordinator-authority-queue-wal-auto-recovered-from-view event.
            // Owner 601f 1a: the content queue index and its shards are no longer added to a full-queue write. They are derived
            // from the resident queue on read (readResidentDerivedQueueIndex in sw.js), so nothing stores them.
        }
        return next
    }

    return {
        summarizeProfileNukeProgressRecord,
        buildProfileNukeProgressView,
        getProfileNukeProgressShardIndex,
        getProfileNukeProgressShardKeyByIndex,
        getProfileNukeProgressShardKey,
        getProfileNukeProgressShardDefaults,
        getAllProfileNukeProgressShardDefaults,
        getProfileNukeProgressProjectionDefaults,
        buildProfileNukeProgressShardPayload,
        hasNonterminalCoordinatorAuthorityForProfile,
        filterProfileNukeProgressForContentProjection,
        getChangedProfileNukeProgressProjectionKeys,
        updateProfileNukeProgressViewRecords,
        updateProfileNukeProgressShardRecord,
        removeProfileNukeProgressViewRecords,
        removeProfileNukeProgressShardRecords,
        normalizeProfileNukeProgressShardRecords,
        getProfileNukeProgressRecordsFromProjection,
        addContentPageStateProjectionPayload
    }
}

module.exports = {
    createProfileNukeProgress
}
