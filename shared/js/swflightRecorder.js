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

const {FLIGHT_RECORDER_CAPACITY} = require('./tunables')
const FLIGHT_RECORDER_STRING_MAX = 240
const FLIGHT_RECORDER_URL_MAX = 500

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

function sanitizeFlightRecorderUrl(value = "") {
    const text = sanitizeFlightRecorderString(value, FLIGHT_RECORDER_URL_MAX)
    if(!text) return ""
    return normalizeQuoraProfileUrl(text) || normalizeTabTargetUrl(text) || text
}

// Every event is kept, and every field is saved. Text is capped and whitespace collapsed; target URLs
// are normalized; numbers and booleans are kept; objects are saved as capped JSON. Only an entry that
// is not an object, or has no kind, is dropped.
function sanitizeFlightRecorderValue(field = "", value) {
    if(value === null || value === undefined) return undefined
    if(typeof value === "number") return Number.isFinite(value) ? value : undefined
    if(typeof value === "boolean") return value
    if(typeof value === "string") {
        return field === "targetUrl" ? sanitizeFlightRecorderUrl(value) : sanitizeFlightRecorderString(value)
    }
    try {
        return sanitizeFlightRecorderString(JSON.stringify(value), FLIGHT_RECORDER_STRING_MAX)
    }
    catch {
        return undefined
    }
}

function sanitizeFlightRecorderEntry(entry = {}) {
    if(!entry || typeof entry !== "object") return null
    const kind = sanitizeFlightRecorderString(entry.kind || "")
    if(!kind) return null

    const sanitized = {
        at: sanitizeFlightRecorderInteger(entry.at) || Date.now(),
        seq: 0,
        kind
    }
    for(const [field, value] of Object.entries(entry)) {
        if(field === "kind" || field === "at" || field === "seq") continue
        const copied = sanitizeFlightRecorderValue(field, value)
        if(copied !== undefined) sanitized[field] = copied
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
// The session copy is capped (see FLIGHT_RECORDER_SESSION_SNAPSHOT_LIMIT in sw.js) so it fits the session quota.
function getFlightRecorderPersistableSnapshot(limit = FLIGHT_RECORDER_CAPACITY) {
    return getFlightRecorderSnapshot({limit})
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
    __testResetFlightRecorder,
    getFlightRecorder,
    getFlightRecorderSnapshot,
    getFlightRecorderPersistableSnapshot,
    recordFlightRecorderEvent,
    seedFlightRecorderFromPersisted
}
