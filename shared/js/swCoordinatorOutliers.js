// The dashboard's outlier list, owned by the worker (docs/queue-storage-layering.md, section 6).
//
// The baseline is a running statistic (IncrementalStats, Welford), not a population. Each finished row is pushed into it exactly once,
// when its archive write is saved, and it is judged just before that push, against the baseline as it stood then, so a row never
// inflates its own baseline. A finished row over the threshold is stored as an outlier entry. Nothing is recomputed from the rows
// on the dashboard, and only finished rows are listed: a running row is not judged.
//   - a finished row's duration is terminalAt minus activeAt, when both are positive; any other row is neither pushed nor judged;
//   - a row is flagged when its duration reaches the 45-second floor, or the stddev threshold (mean + 2.5 sigma) once
//     OUTLIER_MIN_SAMPLES_FOR_STDDEV rows have been pushed;
//   - a flagged row is recorded only at OUTLIER_MIN_RECORD_MS or more (owner, 24 Oct). Every finished row is still pushed;
//   - a recorded entry keeps the flight recorder events that belong to it: every event of its profile or row, and every storage
//     operation (write, update, checkpoint switch) inside its span, whatever its profile. Nothing else. They are copied once, when the
//     row is terminal, and kept until the entry leaves the list. At most OUTLIER_MAX_EVENTS_PER_ENTRY are kept: the newest (27 Oct);
//   - the stored list keeps its newest OUTLIER_MAX_ENTRIES entries;
//   - Clear Outliers dismisses the listed attempts and keeps the baseline; Clear All Stats resets the baseline and the dismissals.
//
// Storage layout (27 Oct). The index, under COORDINATOR_OUTLIERS_KEY, is {layout: 2, entries, baseline: {n, mean, M2}, dismissedKeys}.
// Each index entry is the entry's fields without its events, with its slot. Each listed entry's body (its fields, its slot and its events)
// is under COORDINATOR_OUTLIER_ENTRY_KEY_PREFIX plus its two-digit slot. A slot holds at most one listed entry. A new entry takes a free
// slot, so the write that adds an entry and drops the oldest one writes the new body into the dropped entry's slot: no key is removed by
// a write. Clear and Clear All Stats write null into the slots they empty, in the same write as the index. The 1.6 single-record layout
// (no layout marker, events inside the entries) is read by readCoordinatorOutlierIndex and migrated by the worker (sw.js).
//
// This module does no storage I/O and reads no clock: the caller passes the times, the recorder events and the scan of the recorder.
const {
    OUTLIER_FLOOR_MS,
    OUTLIER_MAX_ENTRIES,
    OUTLIER_MAX_EVENTS_PER_ENTRY,
    OUTLIER_MIN_RECORD_MS,
    OUTLIER_MIN_SAMPLES_FOR_STDDEV,
    OUTLIER_STDDEV_MULTIPLIER
} = require('./tunables')
const {COORDINATOR_OUTLIER_ENTRY_KEY_PREFIX} = require('./storageKeys')

// The layout marker of the index this build writes. An index without it is the 1.6 single-record layout.
const OUTLIER_INDEX_LAYOUT = 2
// The entry slots: one per listed entry at most.
const OUTLIER_ENTRY_SLOT_COUNT = OUTLIER_MAX_ENTRIES

// The storage kinds of the flight recorder: every disk write, every storage update (its settle record and its timeout), and every queue
// checkpoint switch. A storage kind belongs to an outlier by its span, whatever its profile, because it can perturb the row. These are
// the only kinds kept by span. Each kind is recorded at a call site in sw.js or swstorage.js; test/swSynthetic.test.js checks that each
// one is still recorded. The recorder has no storage-read kind.
const OUTLIER_SPAN_EVENT_KINDS = new Set([
    'storage-write',
    'storage-update',
    'storage-update-timeout',
    'queue-wal-checkpoint-switch-start',
    'queue-wal-checkpoint-switch-result'
])

function toInteger(value) {
    return Number.parseInt(value, 10) || 0
}

function toNumber(value) {
    return Number(value) || 0
}

function toText(value) {
    return `${value || ''}`
}

// The running mean and the sum of squared deviations (Welford). Only n, mean and M2 are kept, and those three numbers are the stored
// baseline. The sample variance and stddev are derived from them.
class IncrementalStats {
    constructor(state = null) {
        this.n = 0
        this.mean = 0
        this.M2 = 0
        this.sampleVariance = 0
        this.sampleStdev = 0
        this.restore(state)
    }

    get count() {
        return this.n
    }

    push(x) {
        this.n += 1
        const delta = x - this.mean
        this.mean += delta / this.n
        const delta2 = x - this.mean
        this.M2 += delta * delta2
        this.sampleVariance = this.n > 1 ? this.M2 / (this.n - 1) : 0
        this.sampleStdev = Math.sqrt(this.sampleVariance)
        return this
    }

    state() {
        return {n: this.n, mean: this.mean, M2: this.M2}
    }

    restore(state = null) {
        this.n = Math.max(0, toInteger(state?.n))
        this.mean = toNumber(state?.mean)
        this.M2 = Math.max(0, toNumber(state?.M2))
        this.sampleVariance = this.n > 1 ? this.M2 / (this.n - 1) : 0
        this.sampleStdev = Math.sqrt(this.sampleVariance)
        return this
    }
}

function getCoordinatorOutlierRowKey(item = {}) {
    return `${item?.storageKey || item?.dedupeKey || item?.targetProfileHref || item?.requestedUrl || ''}`.trim()
}

function getCoordinatorOutlierAttemptId(item = {}) {
    return `${item?.attemptId || ''}`.trim()
}

// The profile an outlier belongs to, as the row names it (not normalized). The recorder matches its own normalized copy of it.
function getCoordinatorOutlierTargetUrl(item = {}) {
    return toText(item?.targetProfileHref || item?.requestedUrl || getCoordinatorOutlierRowKey(item))
}

function makeCoordinatorOutlierDismissalKey(rowKey = '', attemptId = '') {
    return `${rowKey}|${attemptId}`
}

// The key a row is dismissed, listed and pruned by.
function getCoordinatorOutlierDismissalKey(item = {}) {
    return makeCoordinatorOutlierDismissalKey(getCoordinatorOutlierRowKey(item), getCoordinatorOutlierAttemptId(item))
}

// The duration a finished row is judged and pushed with: terminalAt minus activeAt, when both are positive. Anything else is 0.
function getCoordinatorOutlierFinishedDuration(item = {}) {
    const activeAt = toInteger(item?.activeAt)
    const terminalAt = toInteger(item?.terminalAt)
    return activeAt > 0 && terminalAt > activeAt ? terminalAt - activeAt : 0
}

// The flag test. The floor always applies. The stddev threshold applies once OUTLIER_MIN_SAMPLES_FOR_STDDEV rows have been pushed. A
// duration under OUTLIER_MIN_RECORD_MS is never flagged, whichever test it would pass. Returns the reason the duration is flagged for, or
// '' when it is not flagged.
function getCoordinatorOutlierThresholdReason(stats, durationMs) {
    if(durationMs < OUTLIER_MIN_RECORD_MS) return ''
    const exceedsAbsolute = durationMs >= OUTLIER_FLOOR_MS
    const exceedsStdDev = stats.count >= OUTLIER_MIN_SAMPLES_FOR_STDDEV &&
        durationMs >= stats.mean + OUTLIER_STDDEV_MULTIPLIER * stats.sampleStdev
    if(!exceedsAbsolute && !exceedsStdDev) return ''
    return exceedsAbsolute && exceedsStdDev ? 'both' : exceedsAbsolute ? 'absolute' : 'stddev'
}

// The stored key of an entry slot: the entry prefix and the slot as two digits.
function getCoordinatorOutlierEntryKey(slot = 0) {
    return `${COORDINATOR_OUTLIER_ENTRY_KEY_PREFIX}${String(toInteger(slot)).padStart(2, '0')}`
}

// The newest OUTLIER_MAX_EVENTS_PER_ENTRY events of an entry (its events are oldest first), and how many older ones the cap dropped.
function capCoordinatorOutlierEvents(events = []) {
    const kept = events.length > OUTLIER_MAX_EVENTS_PER_ENTRY ? events.slice(-OUTLIER_MAX_EVENTS_PER_ENTRY) : events
    return {events: kept, dropped: events.length - kept.length}
}

// The persisted fields of one entry, in a fixed order. durationMs is not persisted: it is computed when the list is served. slot is -1
// until the entry is given one (assignCoordinatorOutlierSlots). eventsDropped counts the events the cap has dropped from this entry.
function normalizeOutlierEntry(entry = {}) {
    const capped = capCoordinatorOutlierEvents(Array.isArray(entry.events) ? entry.events.filter(event => event && typeof event === 'object') : [])
    return {
        slot: Number.isInteger(entry.slot) ? entry.slot : -1,
        rowKey: toText(entry.rowKey),
        targetUrl: toText(entry.targetUrl),
        runId: toText(entry.runId),
        attemptId: toText(entry.attemptId),
        attemptNumber: toInteger(entry.attemptNumber),
        actionKind: toText(entry.actionKind),
        status: toText(entry.status),
        outcome: toText(entry.outcome),
        activeAt: toInteger(entry.activeAt),
        terminalAt: toInteger(entry.terminalAt),
        final: entry.final === true,
        thresholdReason: toText(entry.thresholdReason),
        meanDurationMsAtCapture: toNumber(entry.meanDurationMsAtCapture),
        stdDevMsAtCapture: toNumber(entry.stdDevMsAtCapture),
        capturedAt: toInteger(entry.capturedAt),
        eventsDropped: toInteger(entry.eventsDropped) + capped.dropped,
        events: capped.events
    }
}

// Gives each entry a slot: an entry keeps its slot when it has a valid one no earlier entry has; every other entry takes the lowest free
// slot, in list order. Pure: the input is not changed.
function assignCoordinatorOutlierSlots(entries = []) {
    const used = new Set()
    const kept = entries.map(entry => {
        const slot = Number.isInteger(entry.slot) ? entry.slot : -1
        if(slot >= 0 && slot < OUTLIER_ENTRY_SLOT_COUNT && !used.has(slot)) {
            used.add(slot)
            return entry
        }
        return {...entry, slot: -1}
    })
    let next = 0
    return kept.map(entry => {
        if(entry.slot >= 0) return entry
        while(used.has(next)) next += 1
        used.add(next)
        return {...entry, slot: next}
    })
}

// Any stored value becomes a well-formed record: a missing or malformed value is an empty list with an empty baseline. A record written
// before the accumulator has no n, mean or M2, so its baseline starts at zero. An entry with no events reads as empty. Every entry has a slot.
function normalizeCoordinatorOutliersRecord(value = null) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    const entries = Array.isArray(source.entries) ? source.entries : []
    const dismissedKeys = Array.isArray(source.dismissedKeys) ? source.dismissedKeys : []
    return {
        entries: assignCoordinatorOutlierSlots(entries
            .filter(entry => entry && typeof entry === 'object')
            .map(entry => normalizeOutlierEntry(entry))),
        baseline: new IncrementalStats(source.baseline).state(),
        dismissedKeys: dismissedKeys.map(key => toText(key)).filter(Boolean)
    }
}

// The record sw.js keeps as its base: the stored record with only its listed (final) entries. A non-final entry found in storage is
// dropped here, since only finished rows are listed.
function toCoordinatorOutlierBaseRecord(value = null) {
    const record = normalizeCoordinatorOutliersRecord(value)
    return {...record, entries: record.entries.filter(entry => entry.final)}
}

// Reads the stored index. An index of this layout (the layout marker) has its entries without events: attachCoordinatorOutlierBodies adds
// them from the entry keys. Any other stored value with content is the 1.6 single-record layout: legacy is true, its entries carry their
// events, and droppedEvents counts the events its entries lose to the cap. A missing value is an empty list, not legacy.
function readCoordinatorOutlierIndex(value = null) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : null
    const legacy = source !== null && source.layout !== OUTLIER_INDEX_LAYOUT
    const record = toCoordinatorOutlierBaseRecord(source)
    return {
        record,
        legacy,
        droppedEvents: legacy ? record.entries.reduce((sum, entry) => sum + entry.eventsDropped, 0) : 0
    }
}

// The index as written: the entries without their events (their slot stays), the baseline and the dismissals. Pure.
function makeCoordinatorOutlierIndex(record = null) {
    const next = toCoordinatorOutlierBaseRecord(record)
    return {
        layout: OUTLIER_INDEX_LAYOUT,
        entries: next.entries.map(({events, eventsDropped, ...summary}) => summary),
        baseline: next.baseline,
        dismissedKeys: next.dismissedKeys
    }
}

// The entries of a record with their events, from the bodies read under their slot keys (bodies: the stored value of each key, or null). A
// body is used only when its slot, row and attempt are those of the entry, so a body another write has replaced is never attached. An entry
// without a usable body is kept with no events, and missing counts those entries. Pure.
function attachCoordinatorOutlierBodies(record = null, bodies = {}) {
    const next = toCoordinatorOutlierBaseRecord(record)
    let missing = 0
    const entries = next.entries.map(entry => {
        const body = bodies?.[getCoordinatorOutlierEntryKey(entry.slot)]
        const usable = Boolean(body) && typeof body === 'object' &&
            body.slot === entry.slot && body.attemptId === entry.attemptId && body.rowKey === entry.rowKey
        if(!usable) {
            missing += 1
            return entry
        }
        return normalizeOutlierEntry({...entry, events: body.events, eventsDropped: body.eventsDropped})
    })
    return {record: {...next, entries}, missing}
}

// The entry keys one door write changes, given the record before it and after it. A listed entry whose body is new or differs from its body
// before is written under its slot key; with options.all, every listed entry's body is written (a write made while the disk still holds the
// single-record layout needs all of them). A slot the after-record no longer lists is cleared (null). eventsDropped counts the events the
// cap dropped from the bodies that changed. Returns {writes, clears, entryWrites, bytes, droppedEvents}. Pure.
function diffCoordinatorOutlierBodies(before = null, after = null, options = {}) {
    const beforeEntries = toCoordinatorOutlierBaseRecord(before).entries
    const afterEntries = toCoordinatorOutlierBaseRecord(after).entries
    const beforeTextBySlot = new Map(beforeEntries.map(entry => [entry.slot, JSON.stringify(entry)]))
    const afterSlots = new Set(afterEntries.map(entry => entry.slot))
    const writes = {}
    let bytes = 0
    let droppedEvents = 0
    for(const entry of afterEntries) {
        const text = JSON.stringify(entry)
        const changed = beforeTextBySlot.get(entry.slot) !== text
        if(!changed && !options.all) continue
        writes[getCoordinatorOutlierEntryKey(entry.slot)] = entry
        bytes += text.length
        if(changed) droppedEvents += entry.eventsDropped
    }
    const clears = beforeEntries
        .filter(entry => !afterSlots.has(entry.slot))
        .map(entry => getCoordinatorOutlierEntryKey(entry.slot))
    return {writes, clears, entryWrites: Object.keys(writes).length, bytes, droppedEvents}
}

// The entry stored for a row, from the row's fields. thresholdReason and the baseline the row was judged against are given by the caller.
function makeCoordinatorOutlierEntry(item = {}, fields = {}) {
    return normalizeOutlierEntry({
        rowKey: getCoordinatorOutlierRowKey(item),
        targetUrl: getCoordinatorOutlierTargetUrl(item),
        runId: item.runId || '',
        attemptId: getCoordinatorOutlierAttemptId(item),
        attemptNumber: item.attemptNumber,
        actionKind: item.actionKind || '',
        status: item.status || '',
        outcome: item.outcome || item.error || '',
        activeAt: item.activeAt,
        terminalAt: item.terminalAt,
        final: true,
        thresholdReason: fields.thresholdReason,
        meanDurationMsAtCapture: Math.round(fields.mean),
        stdDevMsAtCapture: Math.round(fields.stdDev),
        capturedAt: fields.capturedAt,
        events: fields.events
    })
}

// Keeps the newest OUTLIER_MAX_ENTRIES entries. The list is in capture order, so the newest entries are last.
function keepNewestCoordinatorOutlierEntries(entries = []) {
    return entries.length > OUTLIER_MAX_ENTRIES ? entries.slice(-OUTLIER_MAX_ENTRIES) : entries
}

// The scope a recorder event is matched against: the row key, the profile (normalized as the recorder normalizes it), and the row's span.
function makeCoordinatorOutlierScope(item = {}, normalizeTargetUrl = value => value) {
    return {
        rowKey: getCoordinatorOutlierRowKey(item),
        targetUrl: normalizeTargetUrl(getCoordinatorOutlierTargetUrl(item)),
        activeAt: toInteger(item.activeAt),
        terminalAt: toInteger(item.terminalAt),
        normalizeTargetUrl
    }
}

// True when an event is about the scope's profile or row. An event that carries a rowKey is judged by that key alone: it is this row's
// event, or its rowKey names this profile; any other rowKey is another row's event, even when its targetUrl is this profile. An event
// with no rowKey is judged by its targetUrl, or its profileHref, against the profile. Pure.
function isCoordinatorOutlierRecorderEventForProfile(event = {}, scope = {}) {
    const normalize = typeof scope.normalizeTargetUrl === 'function' ? scope.normalizeTargetUrl : value => value
    const rowKey = toText(event.rowKey).trim()
    if(rowKey) {
        if(rowKey === scope.rowKey) return true
        return Boolean(scope.targetUrl) && normalize(rowKey) === scope.targetUrl
    }
    if(!scope.targetUrl) return false
    if(event.targetUrl === scope.targetUrl) return true
    return Boolean(event.profileHref) && normalize(event.profileHref) === scope.targetUrl
}

// True when a recorder event belongs to an outlier's scope: it is about the outlier's profile or row (see
// isCoordinatorOutlierRecorderEventForProfile), at any time, or it is a storage kind (OUTLIER_SPAN_EVENT_KINDS) inside the span, from the
// span start to the span end, whatever its profile. An event that matches both is one event. Pure.
function isCoordinatorOutlierRecorderEventInScope(event = {}, scope = {}) {
    if(isCoordinatorOutlierRecorderEventForProfile(event, scope)) return true
    if(!OUTLIER_SPAN_EVENT_KINDS.has(event.kind)) return false
    const at = toInteger(event.at)
    return at >= scope.activeAt && at <= scope.terminalAt
}

// The recorder events kept with each finished row that may be recorded: the rows at OUTLIER_MIN_RECORD_MS or more, each with its events.
// scanRecorder(predicate) returns the recorder's matching events in order; it is the only read of the recorder, and it is made once per
// such row here, at the terminal time. normalizeTargetUrl is the recorder's own normalization of a target address. Returns a Map from
// the row's dismissal key to its events.
function collectCoordinatorOutlierRecorderEvents(rows = [], scanRecorder = () => [], normalizeTargetUrl = value => value) {
    const eventsByKey = new Map()
    for(const row of rows) {
        if(getCoordinatorOutlierFinishedDuration(row) < OUTLIER_MIN_RECORD_MS) continue
        const scope = makeCoordinatorOutlierScope(row, normalizeTargetUrl)
        const events = scanRecorder(event => isCoordinatorOutlierRecorderEventInScope(event, scope))
        eventsByKey.set(getCoordinatorOutlierDismissalKey(row), Array.isArray(events) ? events : [])
    }
    return eventsByKey
}

// Judges and pushes finished rows, in the order given. Each row is judged against the baseline before its own push; a flagged row is
// stored as a final entry (a row already stored under its attempt is updated in place, and keeps its slot); then its duration is pushed. A
// row without a positive duration is neither judged nor pushed. A dismissed attempt is pushed but not listed. recorderEvents is the Map from
// collectCoordinatorOutlierRecorderEvents: a recorded entry takes the events of its row. The entries past OUTLIER_MAX_ENTRIES are dropped
// from the oldest end, and the new entries take free slots. Returns the next record; the input is not changed.
function applyCoordinatorOutlierFinishedRows(record = null, rows = [], nowMs = 0, recorderEvents = new Map()) {
    const now = toInteger(nowMs)
    const next = normalizeCoordinatorOutliersRecord(record)
    const stats = new IncrementalStats(next.baseline)
    const dismissed = new Set(next.dismissedKeys)
    const entries = [...next.entries]
    for(const item of rows) {
        const durationMs = getCoordinatorOutlierFinishedDuration(item)
        if(durationMs <= 0) continue

        const thresholdReason = getCoordinatorOutlierThresholdReason(stats, durationMs)
        const key = getCoordinatorOutlierDismissalKey(item)
        if(thresholdReason && getCoordinatorOutlierRowKey(item) && !dismissed.has(key)) {
            const entry = makeCoordinatorOutlierEntry(item, {
                thresholdReason,
                mean: stats.mean,
                stdDev: stats.sampleStdev,
                capturedAt: now,
                events: recorderEvents.get(key) || []
            })
            const index = entries.findIndex(candidate => makeCoordinatorOutlierDismissalKey(candidate.rowKey, candidate.attemptId) === key)
            if(index >= 0) {
                const existing = entries[index]
                const hasEvents = entry.events.length > 0
                entries[index] = {
                    ...entry,
                    slot: existing.slot,
                    capturedAt: existing.capturedAt,
                    events: hasEvents ? entry.events : existing.events,
                    eventsDropped: hasEvents ? entry.eventsDropped : existing.eventsDropped
                }
            }
            else entries.push(entry)
        }
        stats.push(durationMs)
    }
    return {
        entries: assignCoordinatorOutlierSlots(keepNewestCoordinatorOutlierEntries(entries)),
        baseline: stats.state(),
        dismissedKeys: [...dismissed]
    }
}

// The list as the dashboard shows it: the stored outliers, newest last. Each entry is served with its duration and the number of recorder
// events it keeps; the events themselves are served by getCoordinatorOutlierEvents, on request.
function serveCoordinatorOutliers(record = null) {
    const normalized = normalizeCoordinatorOutliersRecord(record)
    return normalized.entries
        .filter(entry => entry.final)
        .map(({events, eventsDropped, slot, ...entry}) => ({...entry, durationMs: entry.terminalAt - entry.activeAt, eventCount: events.length}))
}

// The recorder events kept with one listed outlier, by its row key and attempt. An unknown attempt has none.
function getCoordinatorOutlierEvents(record = null, rowKey = '', attemptId = '') {
    const key = makeCoordinatorOutlierDismissalKey(toText(rowKey), toText(attemptId))
    const entry = normalizeCoordinatorOutliersRecord(record).entries
        .find(candidate => candidate.final && makeCoordinatorOutlierDismissalKey(candidate.rowKey, candidate.attemptId) === key)
    return entry ? entry.events : []
}

// Clear Outliers: every listed attempt is dismissed, so no later pass lists it again, and the stored list is emptied with its events. The
// baseline is kept.
function applyCoordinatorOutlierClearEntries(record = null) {
    const next = normalizeCoordinatorOutliersRecord(record)
    const dismissed = new Set(next.dismissedKeys)
    for(const entry of next.entries) dismissed.add(makeCoordinatorOutlierDismissalKey(entry.rowKey, entry.attemptId))
    return {entries: [], baseline: next.baseline, dismissedKeys: [...dismissed]}
}

// Clear All Stats: the baseline is reset to zero, and the stored list and its dismissals are cleared.
function applyCoordinatorOutlierReset() {
    return {entries: [], baseline: {n: 0, mean: 0, M2: 0}, dismissedKeys: []}
}

// Drops the dismissals of attempts that are no longer in the live queue. liveKeys holds the dismissal key of each live row.
function pruneCoordinatorOutlierDismissals(record = null, liveKeys = new Set()) {
    const next = normalizeCoordinatorOutliersRecord(record)
    return {...next, dismissedKeys: next.dismissedKeys.filter(key => liveKeys.has(key))}
}

// The record as a comparable string. A write that changes nothing has the same signature, so it is not made.
function getCoordinatorOutliersRecordSignature(value = null) {
    return JSON.stringify(normalizeCoordinatorOutliersRecord(value))
}

module.exports = {
    IncrementalStats,
    OUTLIER_ENTRY_SLOT_COUNT,
    OUTLIER_INDEX_LAYOUT,
    OUTLIER_SPAN_EVENT_KINDS,
    applyCoordinatorOutlierClearEntries,
    applyCoordinatorOutlierFinishedRows,
    applyCoordinatorOutlierReset,
    attachCoordinatorOutlierBodies,
    capCoordinatorOutlierEvents,
    collectCoordinatorOutlierRecorderEvents,
    diffCoordinatorOutlierBodies,
    getCoordinatorOutlierDismissalKey,
    getCoordinatorOutlierEntryKey,
    getCoordinatorOutlierEvents,
    getCoordinatorOutlierFinishedDuration,
    getCoordinatorOutlierTargetUrl,
    getCoordinatorOutliersRecordSignature,
    isCoordinatorOutlierRecorderEventInScope,
    makeCoordinatorOutlierDismissalKey,
    makeCoordinatorOutlierIndex,
    normalizeCoordinatorOutliersRecord,
    pruneCoordinatorOutlierDismissals,
    readCoordinatorOutlierIndex,
    serveCoordinatorOutliers,
    toCoordinatorOutlierBaseRecord
}
