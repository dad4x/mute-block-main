// Runs in the shared log (24 Oct). A runs change becomes records of the generic engine's kinds, in area 'runs': a new run is a map.set, a
// run that changed its scalar fields is a map.patch, a run that gained targets is a map.appendUnique for each list, and a removed run is a
// map.remove. Only the persisted parts of a run are here. Counts and status are not stored; they are worked out from the queue rows at start.
//
// Each record carries every value it adds, so the log alone can rebuild the runs. One call of runsChangeRecords is one run write, which is
// one Nuke 'Em. An unchanged run gives no records.

const RUN_AREA = 'runs'
const RUN_LIST_FIELDS = Object.freeze(['sourcePages', 'targetProfileHrefs', 'targetWorkKeys'])
const RUN_SCALAR_FIELDS = Object.freeze(['sourceType', 'createdAt', 'paused', 'runShard'])

function cleanRunValue(value) {
    return typeof value === 'string' ? value.trim() : ''
}

// The values of `additions` that `existing` does not have yet, in the order given, without repeats.
function newValuesInOrder(existing = [], additions = []) {
    const seen = new Set(existing)
    const fresh = []
    for (const value of Array.isArray(additions) ? additions : []) {
        const cleaned = cleanRunValue(value)
        if (!cleaned || seen.has(cleaned)) continue
        seen.add(cleaned)
        fresh.push(cleaned)
    }
    return fresh
}

// The persisted part of a run: its identity, its scalar fields that are set, and its three lists (empty when absent).
function persistedRunFields(run = {}) {
    const fields = {id: cleanRunValue(run.id)}
    for (const key of RUN_SCALAR_FIELDS) {
        if (run[key] !== undefined) fields[key] = run[key]
    }
    for (const key of RUN_LIST_FIELDS) {
        fields[key] = Array.isArray(run[key]) ? run[key].map(cleanRunValue).filter(Boolean) : []
    }
    return fields
}

// The records for one runs write: `before` and `after` are the runs maps either side of the write. Returns the records in order.
function runsChangeRecords(before = {}, after = {}) {
    const previous = before || {}
    const next = after || {}
    const records = []

    for (const runId of Object.keys(next)) {
        const cleanId = cleanRunValue(runId)
        if (!cleanId) continue
        const current = persistedRunFields({...next[runId], id: next[runId]?.id || cleanId})
        if (!Object.prototype.hasOwnProperty.call(previous, runId)) {
            records.push({kind: 'map.set', area: RUN_AREA, key: cleanId, value: current})
            continue
        }
        const old = persistedRunFields({...previous[runId], id: previous[runId]?.id || cleanId})
        const scalarPatch = {}
        for (const key of RUN_SCALAR_FIELDS) {
            if (JSON.stringify(old[key]) !== JSON.stringify(current[key]) && current[key] !== undefined) {
                scalarPatch[key] = current[key]
            }
        }
        if (Object.keys(scalarPatch).length) {
            records.push({kind: 'map.patch', area: RUN_AREA, key: cleanId, patch: scalarPatch})
        }
        for (const key of RUN_LIST_FIELDS) {
            const fresh = newValuesInOrder(old[key], current[key])
            if (fresh.length) {
                records.push({kind: 'map.appendUnique', area: RUN_AREA, key: cleanId, field: key, values: fresh})
            }
        }
    }

    for (const runId of Object.keys(previous)) {
        if (!Object.prototype.hasOwnProperty.call(next, runId)) {
            records.push({kind: 'map.remove', area: RUN_AREA, key: cleanRunValue(runId)})
        }
    }
    return records
}

// The run cap: the most runs the log keeps (hardcoded: a week at 100 runs a day). The cap drops whole run shards, oldest first (swRunShards.js).
const RUN_RETENTION_MAX_COUNT = 700

module.exports = {
    RUN_RETENTION_MAX_COUNT,
    RUN_AREA,
    RUN_LIST_FIELDS,
    RUN_SCALAR_FIELDS,
    newValuesInOrder,
    persistedRunFields,
    runsChangeRecords
}
