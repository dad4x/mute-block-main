// The dashboard's outlier list, owned by the worker (docs/queue-storage-layering.md, section 6).
//
// The baseline is a running statistic (IncrementalStats, Welford), not a population. Each finished row is pushed into it exactly once,
// when its archive write is saved, and it is judged just before that push, against the baseline as it stood then, so a row never
// inflates its own baseline. A finished row over the threshold is stored as a final outlier entry. Nothing is recomputed from the rows
// on the dashboard.
//   - a finished row's duration is terminalAt minus activeAt, when both are positive; any other row is neither pushed nor judged;
//   - a row is flagged when its duration reaches the 45-second floor, or the stddev threshold (mean + 2.5 sigma) once
//     OUTLIER_MIN_SAMPLES_FOR_STDDEV rows have been pushed;
//   - an active row is judged at each dashboard refresh against the current threshold. That judgement is served, but it is neither
//     pushed nor stored: its status is decided when the row finishes;
//   - the stored list keeps its newest OUTLIER_MAX_ENTRIES entries;
//   - Clear Outliers dismisses the listed attempts and keeps the baseline; Clear All Stats resets the baseline and the dismissals.
// The stored record is {entries, baseline: {n, mean, M2}, dismissedKeys}. sw.js persists it under its own namespace key, in the same
// door write as the archive that pushes the row, so it survives a worker restart. This module does no storage I/O and reads no clock:
// the caller passes the times and the active-status test.
const {
    OUTLIER_FLOOR_MS,
    OUTLIER_MAX_ENTRIES,
    OUTLIER_MIN_SAMPLES_FOR_STDDEV,
    OUTLIER_STDDEV_MULTIPLIER
} = require('./tunables')

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

// The flag test. The floor always applies. The stddev threshold applies once OUTLIER_MIN_SAMPLES_FOR_STDDEV rows have been pushed.
// Returns the reason the duration is flagged for, or '' when it is not flagged.
function getCoordinatorOutlierThresholdReason(stats, durationMs) {
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
        capturedAt: toInteger(entry.capturedAt)
    }
}

// Any stored value becomes a well-formed record: a missing or malformed value is an empty list with an empty baseline. A record written
// before the accumulator has no n, mean or M2, so its baseline starts at zero.
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

// The record sw.js keeps as its base: the stored record with only its decided (final) outliers. An active judgement is never stored
// (judgeCoordinatorOutlierActiveRows), so a non-final entry found in storage is dropped here.
function toCoordinatorOutlierBaseRecord(value = null) {
    const record = normalizeCoordinatorOutliersRecord(value)
    return {...record, entries: record.entries.filter(entry => entry.final)}
}

// The stored entry for a row, from the row's fields. thresholdReason, final and the baseline the row was judged against are given by the caller.
function makeCoordinatorOutlierEntry(item = {}, fields = {}) {
    return normalizeOutlierEntry({
        rowKey: getCoordinatorOutlierRowKey(item),
        targetUrl: item.targetProfileHref || item.requestedUrl || getCoordinatorOutlierRowKey(item),
        runId: item.runId || '',
        attemptId: getCoordinatorOutlierAttemptId(item),
        attemptNumber: item.attemptNumber,
        actionKind: item.actionKind || '',
        status: item.status || '',
        outcome: item.outcome || item.error || '',
        activeAt: item.activeAt,
        terminalAt: item.terminalAt,
        final: fields.final === true,
        thresholdReason: fields.thresholdReason,
        meanDurationMsAtCapture: Math.round(fields.mean),
        stdDevMsAtCapture: Math.round(fields.stdDev),
        capturedAt: fields.capturedAt
    })
}

// Keeps the newest OUTLIER_MAX_ENTRIES entries. The list is in capture order, so the newest entries are last.
function keepNewestCoordinatorOutlierEntries(entries = []) {
    return entries.length > OUTLIER_MAX_ENTRIES ? entries.slice(-OUTLIER_MAX_ENTRIES) : entries
}

// Judges and pushes finished rows, in the order given. Each row is judged against the baseline before its own push; a flagged row is
// stored as a final entry (a row already stored under its attempt is updated in place); then its duration is pushed. A row without a
// positive duration is neither judged nor pushed. A dismissed attempt is pushed but not listed. Returns the next record; the input is
// not changed.
function applyCoordinatorOutlierFinishedRows(record = null, rows = [], nowMs = 0) {
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
                final: true,
                thresholdReason,
                mean: stats.mean,
                stdDev: stats.sampleStdev,
                capturedAt: now
            })
            const existing = entries.find(candidate => makeCoordinatorOutlierDismissalKey(candidate.rowKey, candidate.attemptId) === key)
            if(existing) Object.assign(existing, {...entry, capturedAt: existing.capturedAt})
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

// The active rows, judged at this refresh against the current threshold. An active row's duration is nowMs minus activeAt. A row that
// has a terminalAt is not judged here: it is judged when it archives. A dismissed attempt, or one already stored as final, is not
// listed. Returns the judgements, which are served and never stored. options.previous keeps the capture time of an unchanged judgement.
function judgeCoordinatorOutlierActiveRows(record = null, items = [], options = {}) {
    const nowMs = toInteger(options.nowMs)
    const isActive = typeof options.isActive === 'function' ? options.isActive : () => false
    const normalized = normalizeCoordinatorOutliersRecord(record)
    const stats = new IncrementalStats(normalized.baseline)
    const dismissed = new Set(normalized.dismissedKeys)
    const finalKeys = new Set(
        normalized.entries
            .filter(entry => entry.final)
            .map(entry => makeCoordinatorOutlierDismissalKey(entry.rowKey, entry.attemptId))
    )
    const previousCapturedAt = new Map(
        (Array.isArray(options.previous) ? options.previous : [])
            .map(entry => [makeCoordinatorOutlierDismissalKey(entry.rowKey, entry.attemptId), toInteger(entry.capturedAt)])
    )
    const judged = []
    for(const item of items) {
        const activeAt = toInteger(item?.activeAt)
        if(activeAt <= 0 || toInteger(item?.terminalAt) > 0 || !isActive(item?.status)) continue
        const durationMs = nowMs - activeAt
        if(durationMs <= 0) continue

        const rowKey = getCoordinatorOutlierRowKey(item)
        const key = getCoordinatorOutlierDismissalKey(item)
        if(!rowKey || dismissed.has(key) || finalKeys.has(key)) continue
        const thresholdReason = getCoordinatorOutlierThresholdReason(stats, durationMs)
        if(!thresholdReason) continue
        judged.push(makeCoordinatorOutlierEntry(item, {
            final: false,
            thresholdReason,
            mean: stats.mean,
            stdDev: stats.sampleStdev,
            capturedAt: previousCapturedAt.get(key) || nowMs
        }))
    }
    // Ordered by activeAt, newest activity first, whatever order the live rows came in. A full list keeps its newest entries.
    judged.sort((left, right) => right.activeAt - left.activeAt || left.rowKey.localeCompare(right.rowKey))
    return judged.length > OUTLIER_MAX_ENTRIES ? judged.slice(0, OUTLIER_MAX_ENTRIES) : judged
}

// The list as the dashboard shows it: the stored final outliers, then the active judgements that are not dismissed and not already
// final. A final entry keeps its fixed duration; an active one runs to the time of the answer.
function serveCoordinatorOutliers(record = null, activeJudgements = [], nowMs = 0) {
    const now = toInteger(nowMs)
    const normalized = normalizeCoordinatorOutliersRecord(record)
    const dismissed = new Set(normalized.dismissedKeys)
    const finals = normalized.entries
        .filter(entry => entry.final)
        .map(entry => ({...entry, durationMs: entry.terminalAt - entry.activeAt}))
    const finalKeys = new Set(finals.map(entry => makeCoordinatorOutlierDismissalKey(entry.rowKey, entry.attemptId)))
    const active = (Array.isArray(activeJudgements) ? activeJudgements : [])
        .map(entry => normalizeOutlierEntry(entry))
        .filter(entry => {
            const key = makeCoordinatorOutlierDismissalKey(entry.rowKey, entry.attemptId)
            return !dismissed.has(key) && !finalKeys.has(key)
        })
        .map(entry => ({...entry, durationMs: now - entry.activeAt}))
    return keepNewestCoordinatorOutlierEntries([...finals, ...active])
}

// Clear Outliers: every listed attempt is dismissed, so no later pass lists it again, and the stored list is emptied. The baseline is kept.
// extraDismissKeys are the active judgements the page is clearing too.
function applyCoordinatorOutlierClearEntries(record = null, extraDismissKeys = []) {
    const next = normalizeCoordinatorOutliersRecord(record)
    const dismissed = new Set(next.dismissedKeys)
    for(const entry of next.entries) dismissed.add(makeCoordinatorOutlierDismissalKey(entry.rowKey, entry.attemptId))
    for(const key of extraDismissKeys) if(key) dismissed.add(key)
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
    applyCoordinatorOutlierClearEntries,
    applyCoordinatorOutlierFinishedRows,
    applyCoordinatorOutlierReset,
    getCoordinatorOutlierDismissalKey,
    getCoordinatorOutlierFinishedDuration,
    getCoordinatorOutliersRecordSignature,
    judgeCoordinatorOutlierActiveRows,
    makeCoordinatorOutlierDismissalKey,
    normalizeCoordinatorOutliersRecord,
    pruneCoordinatorOutlierDismissals,
    serveCoordinatorOutliers,
    toCoordinatorOutlierBaseRecord
}
