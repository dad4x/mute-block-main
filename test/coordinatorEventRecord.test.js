const assert = require('node:assert/strict')
const {coordinatorEventToFlightRecorderEntry} = require('../shared/js/coordinatorEventRecord')
const {getFlightRecorderSnapshot, recordFlightRecorderEvent, clearFlightRecorderEntries, __testResetFlightRecorder} = require('../shared/js/swflightRecorder')

const cases = []
const test = (name, fn) => cases.push([name, fn])

async function run(name, fn) {
    try {
        await fn()
        console.log(`ok - ${name}`)
    }
    catch(error) {
        console.log(`not ok - ${name}`)
        console.log(error?.stack || error)
        process.exitCode = 1
    }
}

test('a coordinator event becomes a recorder entry: kind is the type, on the event channel, details flattened', () => {
    const entry = coordinatorEventToFlightRecorderEntry({
        id: 'event-1',
        runId: 'run-1',
        itemId: 'row-1',
        type: 'materialize',
        message: 'Materialized derived enqueue state',
        at: 1234,
        details: {reason: 'enqueue-derived-materialization', coordinatorKey: 'key-1', sourcePageUrl: 'https://www.quora.com/search'}
    })
    assert.equal(entry.kind, 'materialize')
    assert.equal(entry.channel, 'event')
    assert.equal(entry.runId, 'run-1')
    assert.equal(entry.rowKey, 'row-1')
    assert.equal(entry.at, 1234)
    assert.equal(entry.message, 'Materialized derived enqueue state')
    assert.equal(entry.reason, 'enqueue-derived-materialization')
    assert.equal(entry.coordinatorKey, 'key-1')
    assert.equal(entry.sourcePageUrl, 'https://www.quora.com/search')
    assert.equal(entry.id, undefined, 'the event id is not carried')
})

test('a detail named like a reserved recorder field does not overwrite it', () => {
    const entry = coordinatorEventToFlightRecorderEntry({type: 'paused', message: 'Paused', at: 5, details: {kind: 'other', seq: 99, at: 1, message: 'x'}})
    assert.equal(entry.kind, 'paused')
    assert.equal(entry.at, 5)
    assert.equal(entry.message, 'Paused')
    assert.equal(entry.seq, undefined)
})

test('the message is cut to 240 characters', () => {
    const entry = coordinatorEventToFlightRecorderEntry({type: 'x', message: 'a'.repeat(400)})
    assert.equal(entry.message.length, 240)
})

test('the event channel filter returns only event entries, and clearing the recorder empties it', () => {
    __testResetFlightRecorder()
    recordFlightRecorderEvent({kind: 'storage-write', source: 'metricStorageSet'})
    recordFlightRecorderEvent(coordinatorEventToFlightRecorderEntry({type: 'paused', message: 'Paused', at: 1}))
    recordFlightRecorderEvent(coordinatorEventToFlightRecorderEntry({type: 'requeue', message: 'Requeued', at: 2}))
    const events = getFlightRecorderSnapshot({channel: 'event', limit: 10}).entries
    assert.deepEqual(events.map(entry => entry.kind), ['paused', 'requeue'])
    clearFlightRecorderEntries()
    assert.equal(getFlightRecorderSnapshot({channel: 'event', limit: 10}).entries.length, 0)
    assert.equal(getFlightRecorderSnapshot({limit: 10}).entries.length, 0, 'the whole ring is cleared')
    recordFlightRecorderEvent({kind: 'after-clear'})
    assert.deepEqual(getFlightRecorderSnapshot({limit: 10}).entries.map(entry => entry.kind), ['after-clear'], 'recording continues after a clear')
})

;(async () => {
    for (const [name, fn] of cases) await run(name, fn)
})().catch(() => {
    process.exitCode = 1
})
