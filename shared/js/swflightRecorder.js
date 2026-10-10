/*
 * ARCHITECTURE: Flight recorder boundary.
 *
 * The flight recorder is diagnostic state, not authority: it observes
 * machine and runtime transitions but never drives decisions, and it must
 * never write chrome.storage.local (disk-backed, the durable authority
 * store) or schedule work.
 *
 * 2026-09-30: this module still has no dependencies and writes nothing
 * itself -- seedFlightRecorderFromPersisted/getFlightRecorderPersistableSnapshot
 * below are plain functions over plain data, with no browser/storage access
 * of their own. The actual chrome.storage.session persistence (flush on
 * browser.runtime.onSuspend, reseed at startup) is wired up in sw.js via
 * swSessionMemory.js, keeping this file itself free of realm-crossing risk.
 * This persistence used to be flatly forbidden here, on the mistaken belief
 * that in-memory module state survives a service-worker restart -- it
 * doesn't (confirmed live: up to 17 restarts in one ~79-minute session), so
 * without it the recorder was losing its entire buffer on exactly the
 * cadence that matters most for diagnosing across a real run (e.g. the
 * tab-open-request/tab-page-load-complete/profile-action-finalized
 * handoff-phase split this was built for).
 */

const {
    normalizeQuoraProfileHref: normalizeQuoraProfileUrl,
    normalizeTabTargetUrl
} = require('./subject')

const FLIGHT_RECORDER_CAPACITY = 20000 // 2026-09-13: temporarily 10x'd to survive multiple reloads while chasing WAL segment-gap corruption
const FLIGHT_RECORDER_STRING_MAX = 240
const FLIGHT_RECORDER_URL_MAX = 500
const FLIGHT_RECORDER_KINDS = new Set([
    "start-resume",
    "activation-guard-claim",
    "activation-guard-release",
    "activation-guard-hit",
    "activation-guard-prune",
    "fill-decision",
    "fill-recovery",
    "executor-classification",
    "queue-drained",
    "authority-mutation",
    "compact-view-materialized",
    "dashboard-refresh",
    "window-focus-request",
    "tab-open-request",
    "tab-open-result",
    "queued-tab-open-decision",
    "queued-tab-action-pruned",
    "queued-tab-pre-open-recovery",
    "queued-tab-final-open-recovery",
    "queued-attempt-identity-materialization",
    "active-transition",
    "queued-tab-runtime-missing",
    "actorless-requeue",
    "retry-budget-terminalization",
    "retry-budget-recovery",
    "enqueue-failure-terminalization-skip",
    "enqueue-failure-requeue",
    "enqueue-failure-terminalization",
    "already-blocked-observation",
    "blocked-sweep-terminal-result",
    "blocked-live-tab-terminal-result",
    "closed-before-terminal-requeue",
    "tab-action-claim",
    "tab-action-release",
    "close-if-blocked-sent",
    "close-if-blocked-response",
    "cloudflare-challenge-detected",
    "queue-wal-checkpoint-switch-start",
    "queue-wal-checkpoint-switch-result",
    "queue-wal-auto-recovery",
    // 2026-09-29 tracing addition (project_open_issues_2026_09_27.md issue
    // 2/classification): item.initialBlockedState (mutateCoordinatorInitialBlockedState,
    // sw.js) decides reallyBlocked vs alreadyBlocked for the entire life of a
    // row and is captured exactly once, first-report-wins -- but had no
    // tracing at all, so a misclassification (confirmed live: FPT-Camera-3
    // landed alreadyBlocked despite ~23s of active in-session polling that
    // looks like a genuine live block, not a pre-existing one) couldn't be
    // traced back to which report won the race, or why the early
    // not-blocked observations apparently lost it.
    "initial-blocked-state-record",
    // 2026-09-29: Zoe-Lyta orphaned-tab incident -- terminalizeActiveCoordinatorItemFromBlockedLiveTab
    // archived the row as succeeded and reported terminalized:true, but the
    // live browser tab stayed open (found later with no mbCoordinatorQueue
    // record at all). browser.tabs.remove() was wrapped in .catch(() => {})
    // with no trace of the outcome, so a failed/no-op removal was
    // indistinguishable from a successful one after the fact.
    "terminal-tab-close-result",
    // 2026-09-30: splits a handoff gap (activationHandoffTiming's single
    // terminal->nextActive number) into its three stages -- previous row's
    // profile-action-finalized -> this row's tab-open-request is our own
    // scheduling overhead; tab-open-request -> tab-page-load-complete is
    // the browser's page load, not ours; tab-page-load-complete -> this
    // row's own profile-action-finalized is our block-and-finalize
    // processing. Correlated across the three by targetUrl (and rowKey/
    // runId where available), not a dedicated id, since they're emitted
    // from three independent call sites that don't share one.
    "tab-page-load-complete",
    "profile-action-finalized"
])

let flightRecorderSeq = 0
let flightRecorderDroppedCount = 0
const flightRecorderEntries = new Array(FLIGHT_RECORDER_CAPACITY)

function sanitizeFlightRecorderString(value = "", maxLength = FLIGHT_RECORDER_STRING_MAX) {
    if(value === null || value === undefined) return ""
    const text = `${value}`.replace(/\s+/g, " ").trim()
    const limit = Math.max(8, Number.parseInt(maxLength, 10) || FLIGHT_RECORDER_STRING_MAX)
    return text.length > limit ? `${text.slice(0, limit - 3)}...` : text
}

function sanitizeFlightRecorderInteger(value = null) {
    if(value === null || value === undefined || value === "") return undefined
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : undefined
}

function sanitizeFlightRecorderBoolean(value = null) {
    return typeof value === "boolean" ? value : undefined
}

function sanitizeFlightRecorderUrl(value = "") {
    const text = sanitizeFlightRecorderString(value, FLIGHT_RECORDER_URL_MAX)
    if(!text) return ""
    return normalizeQuoraProfileUrl(text) || normalizeTabTargetUrl(text) || text
}

function sanitizeFlightRecorderEntry(entry = {}) {
    const kind = sanitizeFlightRecorderString(entry?.kind || "")
    if(!FLIGHT_RECORDER_KINDS.has(kind)) return null

    const sanitized = {
        at: sanitizeFlightRecorderInteger(entry?.at) || Date.now(),
        seq: 0,
        kind
    }
    const stringFields = [
        "source",
        "operationKind",
        "rowKey",
        "attemptId",
        "runId",
        "statusBefore",
        "statusAfter",
        "reason",
        "terminalizationPolicy",
        "enqueueResultReason",
        "fillResultReason",
        "fillError",
        "error",
        "generationId"
    ]
    for(const field of stringFields) {
        const value = sanitizeFlightRecorderString(entry?.[field] || "")
        if(value) sanitized[field] = value
    }
    const targetUrl = sanitizeFlightRecorderUrl(entry?.targetUrl || "")
    if(targetUrl) sanitized.targetUrl = targetUrl

    for(const field of [
        "attemptNumber",
        "tabId",
        "windowId",
        "elapsedMs",
        "enqueueQueued",
        "enqueueQueuedKeysCount",
        "enqueueTerminalizedExhausted",
        "enqueueTerminalizedExhaustedKeysCount",
        "fillOpenedTabs",
        "fillActive",
        "fillSchedulerBlockingActive",
        "fillRemainingActions",
        "queuedTabActionsCount",
        "activeQueuedTabsCount",
        "pendingTabActionsCount",
        "durablyActiveQueuedTabsCount",
        "durableActiveRows",
        "durableQueuedRows",
        "durableTerminalRows",
        "snapshotSeq",
        "checkpointedRecords",
        "committedSegmentsA",
        "committedSegmentsB",
        "retiredKeys",
        "viewItemCount",
        "rebuiltRowCount",
        "durationMs",
        "activeAt"
    ]) {
        const value = sanitizeFlightRecorderInteger(entry?.[field])
        if(value !== undefined) sanitized[field] = value
    }
    for(const field of ["accepted", "durable", "changed", "fillTimedOut", "runtimeSurfaceBefore", "blocked"]) {
        const value = sanitizeFlightRecorderBoolean(entry?.[field])
        if(value !== undefined) sanitized[field] = value
    }

    return sanitized
}

function getFlightRecorderBounds() {
    const newestSeq = flightRecorderSeq
    const retained = Math.min(newestSeq, FLIGHT_RECORDER_CAPACITY)
    return {
        oldestSeq: retained ? newestSeq - retained + 1 : 0,
        newestSeq
    }
}

function getFlightRecorderEntriesOrdered() {
    const bounds = getFlightRecorderBounds()
    const entries = []
    for(let seq = bounds.oldestSeq; seq <= bounds.newestSeq; seq += 1) {
        if(!seq) continue
        const entry = flightRecorderEntries[seq % FLIGHT_RECORDER_CAPACITY]
        if(entry?.seq === seq) entries.push({...entry})
    }
    return entries
}

function recordFlightRecorderEvent(entry = {}) {
    try {
        const sanitized = sanitizeFlightRecorderEntry(entry)
        if(!sanitized) return false
        flightRecorderSeq += 1
        sanitized.seq = flightRecorderSeq
        flightRecorderEntries[flightRecorderSeq % FLIGHT_RECORDER_CAPACITY] = sanitized
        flightRecorderDroppedCount = Math.max(0, flightRecorderSeq - FLIGHT_RECORDER_CAPACITY)
        return true
    }
    catch {
        return false
    }
}

function getFlightRecorderSnapshot(request = {}) {
    try {
        const bounds = getFlightRecorderBounds()
        const limit = Math.max(1, Math.min(
            FLIGHT_RECORDER_CAPACITY,
            Number.parseInt(request?.limit, 10) || 100
        ))
        const sinceSeq = Math.max(0, Number.parseInt(request?.sinceSeq, 10) || 0)
        const kind = sanitizeFlightRecorderString(request?.kind || "")
        const rowKey = sanitizeFlightRecorderString(request?.rowKey || "")
        const targetUrl = sanitizeFlightRecorderUrl(request?.targetUrl || "")
        let entries = getFlightRecorderEntriesOrdered()
            .filter(entry => entry.seq > sinceSeq)
        if(kind) entries = entries.filter(entry => entry.kind === kind)
        if(rowKey) entries = entries.filter(entry => entry.rowKey === rowKey)
        if(targetUrl) entries = entries.filter(entry => entry.targetUrl === targetUrl)
        entries = entries.slice(Math.max(0, entries.length - limit))
        return {
            readOnly: true,
            capacity: FLIGHT_RECORDER_CAPACITY,
            droppedCount: flightRecorderDroppedCount,
            oldestSeq: bounds.oldestSeq,
            newestSeq: bounds.newestSeq,
            entries
        }
    }
    catch {
        return {
            readOnly: true,
            capacity: FLIGHT_RECORDER_CAPACITY,
            droppedCount: flightRecorderDroppedCount,
            oldestSeq: 0,
            newestSeq: flightRecorderSeq,
            entries: []
        }
    }
}

function getFlightRecorder(request = {}) {
    return Promise.resolve(getFlightRecorderSnapshot(request))
}

function __testResetFlightRecorder() {
    flightRecorderSeq = 0
    flightRecorderDroppedCount = 0
    flightRecorderEntries.fill(undefined)
}

// Everything this instance would need to reconstruct its buffer elsewhere
// (or in a fresh instance after this one is evicted) -- the full resident
// window, not just whatever a caller's own `limit` asked for.
function getFlightRecorderPersistableSnapshot() {
    return getFlightRecorderSnapshot({limit: FLIGHT_RECORDER_CAPACITY})
}

// Repopulates the buffer from a previously-persisted snapshot (see
// getFlightRecorderPersistableSnapshot). Only seeds an instance that hasn't
// recorded anything of its own yet (flightRecorderSeq === 0) -- this is
// meant to run once, at startup, before any real event has had a chance to
// land; if one already has by the time an async session-storage load
// resolves, that genuine live data wins and the persisted snapshot is
// dropped rather than risking it clobbering something newer.
function seedFlightRecorderFromPersisted(persisted = null) {
    if(flightRecorderSeq !== 0) return false
    const entries = Array.isArray(persisted?.entries) ? persisted.entries : []
    if(!entries.length) return false

    let maxSeq = 0
    for(const entry of entries) {
        const sanitized = sanitizeFlightRecorderEntry(entry)
        if(!sanitized) continue
        const seq = Number.parseInt(entry?.seq, 10)
        if(!Number.isFinite(seq) || seq <= 0) continue
        sanitized.seq = seq
        flightRecorderEntries[seq % FLIGHT_RECORDER_CAPACITY] = sanitized
        if(seq > maxSeq) maxSeq = seq
    }
    if(!maxSeq) return false

    flightRecorderSeq = maxSeq
    const persistedDropped = Number.parseInt(persisted?.droppedCount, 10) || 0
    flightRecorderDroppedCount = Math.max(persistedDropped, Math.max(0, flightRecorderSeq - FLIGHT_RECORDER_CAPACITY))
    return true
}

module.exports = {
    FLIGHT_RECORDER_CAPACITY,
    FLIGHT_RECORDER_KINDS,
    __testResetFlightRecorder,
    getFlightRecorder,
    getFlightRecorderSnapshot,
    getFlightRecorderPersistableSnapshot,
    recordFlightRecorderEvent,
    seedFlightRecorderFromPersisted
}
