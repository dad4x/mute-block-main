// Coordinator diagnostic events go to the flight recorder, not to storage (events-to-flight-recorder-design.md, section 7, B8a).
// The recorder entry's kind is the event type. The event's details are flattened to top-level fields, so the recorder's own
// per-field caps apply. Reserved recorder fields are never overwritten. Pure: no storage, no recorder access here.

const RESERVED_RECORDER_FIELDS = new Set(['kind', 'at', 'seq', 'message', 'runId', 'rowKey'])

function coordinatorEventToFlightRecorderEntry(event = {}) {
    const kind = `${event?.type || 'coordinator-diagnostic'}`.trim() || 'coordinator-diagnostic'
    const entry = {kind, channel: 'event', message: `${event?.message || ''}`.slice(0, 240)}
    if(event?.runId) entry.runId = `${event.runId}`
    if(event?.itemId) entry.rowKey = `${event.itemId}`
    const at = Number.parseInt(event?.at, 10)
    if(at > 0) entry.at = at
    const details = event?.details && typeof event.details === 'object' ? event.details : {}
    for(const [field, value] of Object.entries(details)) {
        if(RESERVED_RECORDER_FIELDS.has(field) || value === undefined) continue
        entry[field] = value
    }
    return entry
}

module.exports = {coordinatorEventToFlightRecorderEntry}
