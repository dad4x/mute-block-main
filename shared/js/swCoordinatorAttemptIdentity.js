// Attempt-identity primitives extracted from sw.js (decomposition Slice 11,
// part 1 of 2). These are the id/number generators and mismatch predicates
// almost everything else in the coordinator reconcile core reads to know
// which worker attempt a queued/active item or an incoming progress record
// belongs to: getAttemptIdFromValue (251 external refs pre-move) and
// getAttemptNumberFromValue (221 refs) are two of the most widely used
// functions in the whole file.
//
// All 13 functions here are plain synchronous functions with no `async`
// keyword and no Promise/`.then()`/`.catch()` chain in their bodies (grepped
// every body before moving, per architecture.md's "Module Extraction And
// The Test Harness Realm Boundary" section, "Refinement found during ...
// Slice 7" paragraph) -- none of them carry any realm-crossing risk either
// direction. makeId reads `Date.now()` to salt its generated id string, so
// per the plan's clock/environment-global note it gets `now: () => Date.now()`
// threaded through deps like every other extracted module's clock-reading
// function, even though nothing here looks timing-related by name.
//
// Split rationale (this module vs. swCoordinatorJobEnvelope.js): several of
// these functions -- getAttemptIdFromValue, getAttemptNumberFromValue,
// hasMismatchedCoordinatorAttempt, and makeId -- are referenced eagerly
// (deps.handlers object-literal shorthand) inside other already-extracted
// modules' construction at sw.js module-eval time: browserSessionRuntime
// (old line ~579) needs makeId, activationGuardRuntime (old line ~1254) and
// coordinatorReconcileInputs (old line ~1328) both need
// getAttemptIdFromValue/getAttemptNumberFromValue, and queuedTabRuntimeStatus
// (old line ~1675) needs hasMismatchedCoordinatorAttempt too -- all four
// constructed well before this slice's functions' old source-text position
// (~4000+). A hoisted `function` declaration is visible throughout its whole
// scope, but a `const` destructured from a factory call is in the temporal
// dead zone until that line executes -- so this module has to be constructed
// before browserSessionRuntime, the earliest of those four, which is earlier
// than swCoordinatorJobEnvelope.js needs to be (its own earliest eager
// dependent, queuedTabRuntimeStatus needing applyCoordinatorJobEnvelope, is
// satisfiable later, right after storageUpdateState exists). Keeping this
// module small and dependency-free (no queueWakeupMetricsShape, no
// storageUpdateState, no profileResolution) is what lets it construct that
// early without any thunk tricks. swCoordinatorJobEnvelope.js's makeId use
// is threaded through as a handler dep from this module's export.
//
// isCoordinatorQueueAuthoritativeItem, isTerminalCoordinatorStatus, and
// isTerminalProfileNukeRecord all stay in sw.js as plain hoisted function
// declarations (untouched by this slice) and are threaded through as
// handler deps -- hoisted declarations are visible from anywhere in their
// enclosing scope regardless of textual position, so no TDZ concern on
// their side.

function createCoordinatorAttemptIdentity(deps = {}) {
    const now = typeof deps.now === 'function' ? deps.now : () => Date.now()
    const {
        normalizeQuoraProfileUrl
    } = deps.handlers || {}
    const {
        isCoordinatorQueueAuthoritativeItem,
        isTerminalCoordinatorStatus,
        isTerminalProfileNukeRecord
    } = deps.handlers || {}

    function makeId(prefix) {
        return `${prefix}-${now()}-${Math.random().toString(36).slice(2, 8)}`
    }

    function makeAttemptId() {
        return makeId('attempt')
    }

    function normalizeAttemptId(value = '') {
        return `${value || ''}`.trim()
    }

    function getAttemptIdFromValue(value = null) {
        if(!value || typeof value !== 'object') return ''
        return normalizeAttemptId(value.attemptId || value.attempt?.id || '')
    }

    function getAttemptNumberFromValue(value = null) {
        if(!value || typeof value !== 'object') return 0
        return Number.parseInt(value.attemptNumber ?? value.attempt?.number, 10) || 0
    }

    function getNextAttemptNumberFromValue(value = null) {
        return Math.max(1, getAttemptNumberFromValue(value) + 1)
    }

    function makeCoordinatorInFlightMutationKey(prefix = '', itemKey = '', item = null, extra = '') {
        return [
            `${prefix || 'coordinator-mutation'}`.trim(),
            normalizeQuoraProfileUrl(itemKey) || `${itemKey || ''}`.trim(),
            getAttemptIdFromValue(item),
            getAttemptNumberFromValue(item),
            `${extra || ''}`.trim()
        ].join('|')
    }

    function normalizeCoordinatorMap(value) {
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    }

    function normalizeCoordinatorEvents(value) {
        if(Array.isArray(value)) return value.filter(event => event && typeof event === 'object')
        return Object.values(normalizeCoordinatorMap(value)).filter(event => event && typeof event === 'object')
    }

    function isAttemptTrackedCoordinatorItem(item = null) {
        return !!item &&
            isCoordinatorQueueAuthoritativeItem(item) &&
            (getAttemptIdFromValue(item) || getAttemptNumberFromValue(item))
    }

    function isNewerTerminalProgressForCoordinatorItem(item = null, record = null) {
        if(!item || !record) return false
        if(isTerminalCoordinatorStatus(item?.status)) return false
        if(!isTerminalProfileNukeRecord(record)) return false

        const expectedAttemptNumber = getAttemptNumberFromValue(item)
        const incomingAttemptNumber = getAttemptNumberFromValue(record)
        if(!expectedAttemptNumber || !incomingAttemptNumber) return false
        if(incomingAttemptNumber <= expectedAttemptNumber) return false

        const itemRunId = `${item?.runId || ''}`.trim()
        const recordRunId = `${record?.runId || ''}`.trim()
        if(itemRunId && recordRunId && itemRunId !== recordRunId) return false

        const itemQueuedAt = Number.parseInt(item?.queuedAt || item?.createdAt || 0, 10) || 0
        const recordTerminalAt = Number.parseInt(record?.terminalAt || record?.tabClosedAt || record?.updatedAt || 0, 10) || 0
        if(itemQueuedAt && recordTerminalAt && recordTerminalAt < itemQueuedAt) return false

        return true
    }

    function hasMismatchedCoordinatorAttempt(item = null, record = null) {
        if(!isTerminalCoordinatorStatus(item?.status) && isTerminalProfileNukeRecord(record)) {
            const itemQueuedAt = Number.parseInt(item?.queuedAt || item?.createdAt || 0, 10) || 0
            const recordTerminalAt = Number.parseInt(record?.terminalAt || record?.tabClosedAt || record?.updatedAt || 0, 10) || 0
            if(itemQueuedAt && recordTerminalAt && recordTerminalAt < itemQueuedAt) return true
        }

        if(isNewerTerminalProgressForCoordinatorItem(item, record)) return false

        const expectedAttemptId = getAttemptIdFromValue(item)
        const incomingAttemptId = getAttemptIdFromValue(record)
        if(expectedAttemptId && incomingAttemptId && expectedAttemptId !== incomingAttemptId) return true

        const expectedAttemptNumber = getAttemptNumberFromValue(item)
        const incomingAttemptNumber = getAttemptNumberFromValue(record)
        if(expectedAttemptNumber && incomingAttemptNumber && expectedAttemptNumber !== incomingAttemptNumber) return true

        if(!isTerminalCoordinatorStatus(item?.status) && isAttemptTrackedCoordinatorItem(item)) {
            if(expectedAttemptId && !incomingAttemptId) return true
            if(expectedAttemptNumber && !incomingAttemptNumber) return true
        }

        return !isTerminalCoordinatorStatus(item?.status) &&
            !!expectedAttemptId &&
            !incomingAttemptId &&
            isTerminalProfileNukeRecord(record)
    }

    function getResolvedDestinationConflict(existingResolvedItem = null, sourceItem = null) {
        if(!existingResolvedItem) return ''
        if(existingResolvedItem.status === 'succeeded') return ''
        if(isTerminalCoordinatorStatus(existingResolvedItem.status)) return 'terminal-resolved-coordinator-item'
        if(hasMismatchedCoordinatorAttempt(existingResolvedItem, sourceItem)) return 'resolved-coordinator-conflict'
        return ''
    }

    return {
        makeId,
        makeAttemptId,
        normalizeAttemptId,
        getAttemptIdFromValue,
        getAttemptNumberFromValue,
        getNextAttemptNumberFromValue,
        makeCoordinatorInFlightMutationKey,
        normalizeCoordinatorMap,
        normalizeCoordinatorEvents,
        isAttemptTrackedCoordinatorItem,
        isNewerTerminalProgressForCoordinatorItem,
        hasMismatchedCoordinatorAttempt,
        getResolvedDestinationConflict
    }
}

module.exports = {
    createCoordinatorAttemptIdentity
}
