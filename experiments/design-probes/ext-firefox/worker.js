// Stands in for the owner's Worker. Replays a batch of stored values into a Map,
// the way startup replay would. Accepts either structured-clone entries or an
// ArrayBuffer of JSON (transferred).
const state = new Map()

function apply(entries) {
    let records = 0
    for(const entry of entries) {
        const parsed = JSON.parse(entry.value)
        for(const record of parsed.records) {
            state.set(record.k, record)
            records += 1
        }
    }
    return records
}

self.onmessage = (event) => {
    const started = performance.now()
    const data = event.data
    let entries
    if(data.op === 'replay-buffer') {
        entries = JSON.parse(new TextDecoder().decode(data.buffer))
    }
    else {
        entries = data.entries
    }
    const records = apply(entries)
    self.postMessage({id: data.id, records, replayMs: performance.now() - started})
}
