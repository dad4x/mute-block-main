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
//   - a recorded entry keeps the flight recorder events that belong to it: the events of its target profile, and the storage and
//     checkpoint writes inside its span. They are copied once, when the row is terminal, and kept until the entry leaves the list;
//   - the stored list keeps its newest OUTLIER_MAX_ENTRIES entries;
//   - Clear Outliers dismisses the listed attempts and keeps the baseline; Clear All Stats resets the baseline and the dismissals.
// The stored record is {entries, baseline: {n, mean, M2}, dismissedKeys}. sw.js persists it under its own namespace key, in the same
// door write as the archive that pushes the row, so it survives a worker restart. This module does no storage I/O and reads no clock:
// the caller passes the times, the recorder events and the scan of the recorder.
const {
    OUTLIER_FLOOR_MS,
    OUTLIER_MAX_ENTRIES,
    OUTLIER_MIN_RECORD_MS,
    OUTLIER_MIN_SAMPLES_FOR_STDDEV,
    OUTLIER_STDDEV_MULTIPLIER
} = require('./tunables')

// The recorder kinds that belong to an outlier by its span, whatever their profile: the disk writes and the queue checkpoint switches,
// which can perturb a row. Storage-update settle records, pause and dashboard events are left out (plan, section 2).
// Each kind is recorded at a call site in sw.js or swstorage.js; test/swSynthetic.test.js checks that each one is still recorded.
const OUTLIER_SPAN_EVENT_KINDS = new Set([
    'storage-write',
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

// The persisted fields of one entry, in a fixed order. durationMs is not persisted: it is computed when the list is served.
function normalizeOutlierEntry(entry = {}) {
    return {
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
        events: Array.isArray(entry.events) ? entry.events.filter(event => event && typeof event === 'object') : []
    }
}

// Any stored value becomes a well-formed record: a missing or malformed value is an empty list with an empty baseline. A record written
// before the accumulator has no n, mean or M2, so its baseline starts at zero. A record written before the recorder events existed has
// no events, so its entries read as empty.
function normalizeCoordinatorOutliersRecord(value = null) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    const entries = Array.isArray(source.entries) ? source.entries : []
    const dismissedKeys = Array.isArray(source.dismissedKeys) ? source.dismissedKeys : []
    return {
        entries: entries
            .filter(entry => entry && typeof entry === 'object')
            .map(entry => normalizeOutlierEntry(entry)),
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

// The stored entry for a row, from the row's fields. thresholdReason and the baseline the row was judged against are given by the caller.
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

// The scope a recorder event is matched against: the profile, and the row's span.
function makeCoordinatorOutlierScope(item = {}, normalizeTargetUrl = value => value) {
    return {
        targetUrl: normalizeTargetUrl(getCoordinatorOutlierTargetUrl(item)),
        activeAt: toInteger(item.activeAt),
        terminalAt: toInteger(item.terminalAt)
    }
}

// True when a recorder event belongs to an outlier's scope: it is for the same target profile (exact match on the normalized address),
// or it is a span kind (a disk write or checkpoint switch) inside the span. Pure.
function isCoordinatorOutlierRecorderEventInScope(event = {}, scope = {}) {
    if(scope.targetUrl && event.targetUrl === scope.targetUrl) return true
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
// stored as a final entry (a row already stored under its attempt is updated in place); then its duration is pushed. A row without a
// positive duration is neither judged nor pushed. A dismissed attempt is pushed but not listed. recorderEvents is the Map from
// collectCoordinatorOutlierRecorderEvents: a recorded entry takes the events of its row. Returns the next record; the input is not changed.
function applyCoordinatorOutlierFinishedRows(record = null, rows = [], nowMs = 0, recorderEvents = new Map()) {
    const now = toInteger(nowMs)
    const next = normalizeCoordinatorOutliersRecord(record)
    const stats = new IncrementalStats(next.baseline)
    const dismissed = new Set(next.dismissedKeys)
    const entries = next.entries
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
            const existing = entries.find(candidate => makeCoordinatorOutlierDismissalKey(candidate.rowKey, candidate.attemptId) === key)
            if(existing) Object.assign(existing, {...entry, capturedAt: existing.capturedAt, events: entry.events.length ? entry.events : existing.events})
            else entries.push(entry)
        }
        stats.push(durationMs)
    }
    return {
        entries: keepNewestCoordinatorOutlierEntries(entries),
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
        .map(({events, ...entry}) => ({...entry, durationMs: entry.terminalAt - entry.activeAt, eventCount: events.length}))
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
    OUTLIER_SPAN_EVENT_KINDS,
    applyCoordinatorOutlierClearEntries,
    applyCoordinatorOutlierFinishedRows,
    applyCoordinatorOutlierReset,
    collectCoordinatorOutlierRecorderEvents,
    getCoordinatorOutlierDismissalKey,
    getCoordinatorOutlierEvents,
    getCoordinatorOutlierFinishedDuration,
    getCoordinatorOutlierTargetUrl,
    getCoordinatorOutliersRecordSignature,
    isCoordinatorOutlierRecorderEventInScope,
    makeCoordinatorOutlierDismissalKey,
    normalizeCoordinatorOutliersRecord,
    pruneCoordinatorOutlierDismissals,
    serveCoordinatorOutliers,
    toCoordinatorOutlierBaseRecord
}
