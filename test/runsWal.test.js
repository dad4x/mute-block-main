// Runs as records of the shared log engine (swRunsWal.js). Each test turns a runs change into records and replays them through the engine's own
// applyWalRecord, then compares the result with the runs the worker meant to write.
const assert = require('node:assert/strict')
const {applyWalRecord} = require('../shared/js/walSnapshotStore')
const {persistedRunFields, runsChangeRecords} = require('../shared/js/swRunsWal')

let failed = 0
function test(name, fn) {
    try {
        fn()
        console.log(`ok - ${name}`)
    }
    catch (error) {
        failed += 1
        console.log(`not ok - ${name}`)
        console.log(error?.stack || error)
    }
}

const HREF_A = 'https://www.quora.com/profile/Alpha-1'
const HREF_B = 'https://www.quora.com/profile/Bravo-2'
const HREF_C = 'https://www.quora.com/profile/Charlie-3'
const PAGE_1 = 'https://trollsgalore.quora.com/post-1'
const PAGE_2 = 'https://trollsgalore.quora.com/post-2'

// Replays records through the engine, the way the log replay does, starting from the runs map `start`.
function replay(start, records) {
    let state = {runs: JSON.parse(JSON.stringify(start || {}))}
    const appliedIds = new Set()
    records.forEach((record, index) => {
        const result = applyWalRecord(state, {...record, seq: index + 1}, {appliedIds, ownedAreas: new Set()})
        state = result.state
    })
    return state.runs || {}
}

// The persisted view of every run, so counts and status (not stored) do not take part in the comparison.
function persistedView(runs) {
    return Object.fromEntries(Object.entries(runs).map(([id, run]) => [id, persistedRunFields(run)]))
}

test('a new run becomes one map.set and replays to the same run', () => {
    const after = {
        'run-1': {id: 'run-1', sourceType: 'space-feed', createdAt: 100, sourcePages: [PAGE_1], targetProfileHrefs: [HREF_A, HREF_B], targetWorkKeys: [HREF_A, HREF_B]}
    }
    const records = runsChangeRecords({}, after)
    assert.equal(records.length, 1)
    assert.equal(records[0].kind, 'map.set')
    assert.deepEqual(persistedView(replay({}, records)), persistedView(after))
})

test('targets added to an existing run become map.appendUnique records carrying only the new values', () => {
    const before = {'run-1': {id: 'run-1', sourceType: 'space-feed', createdAt: 100, sourcePages: [PAGE_1], targetProfileHrefs: [HREF_A], targetWorkKeys: [HREF_A]}}
    const after = {'run-1': {id: 'run-1', sourceType: 'space-feed', createdAt: 100, sourcePages: [PAGE_1, PAGE_2], targetProfileHrefs: [HREF_A, HREF_B, HREF_C], targetWorkKeys: [HREF_A, HREF_B]}}
    const records = runsChangeRecords(before, after)
    const appends = records.filter(record => record.kind === 'map.appendUnique')
    assert.deepEqual(appends.map(record => [record.field, record.values]), [
        ['sourcePages', [PAGE_2]],
        ['targetProfileHrefs', [HREF_B, HREF_C]],
        ['targetWorkKeys', [HREF_B]]
    ])
    assert.deepEqual(persistedView(replay(before, records)), persistedView(after))
})

test('a run whose scalar fields changed becomes a map.patch with only those fields', () => {
    const before = {'run-1': {id: 'run-1', sourceType: 'space-feed', createdAt: 100, paused: false, targetProfileHrefs: [HREF_A]}}
    const after = {'run-1': {...before['run-1'], paused: true}}
    const records = runsChangeRecords(before, after)
    assert.equal(records.length, 1)
    assert.deepEqual(records[0], {kind: 'map.patch', area: 'runs', key: 'run-1', patch: {paused: true}})
    assert.equal(replay(before, records)['run-1'].paused, true)
})

test('a removed run becomes a map.remove and replays to no run', () => {
    const before = {'run-1': {id: 'run-1', sourceType: 'space-feed', createdAt: 1, targetProfileHrefs: [HREF_A]}}
    const records = runsChangeRecords(before, {})
    assert.deepEqual(records, [{kind: 'map.remove', area: 'runs', key: 'run-1'}])
    assert.deepEqual(replay(before, records), {})
})

test('an unchanged runs map gives no records', () => {
    const runs = {'run-1': {id: 'run-1', sourceType: 'space-feed', createdAt: 1, targetProfileHrefs: [HREF_A], targetWorkKeys: [HREF_A]}}
    assert.deepEqual(runsChangeRecords(runs, JSON.parse(JSON.stringify(runs))), [])
})

test('counts and status are not part of the records', () => {
    const before = {'run-1': {id: 'run-1', sourceType: 'space-feed', createdAt: 1, targetProfileHrefs: [], activeCount: 0, status: 'queued'}}
    const after = {'run-1': {...before['run-1'], activeCount: 3, terminalCount: 2, status: 'active', updatedAt: 99}}
    assert.deepEqual(runsChangeRecords(before, after), [])
})

test('one write with a new run and a target added to an old run gives one record set that replays to both', () => {
    const before = {'run-1': {id: 'run-1', sourceType: 'space-feed', createdAt: 1, sourcePages: [PAGE_1], targetProfileHrefs: [HREF_A], targetWorkKeys: [HREF_A]}}
    const after = {
        ...before,
        'run-2': {id: 'run-2', sourceType: 'space-feed', createdAt: 2, sourcePages: [PAGE_2], targetProfileHrefs: [HREF_B], targetWorkKeys: [HREF_B]},
        'run-1': {...before['run-1'], targetProfileHrefs: [HREF_A, HREF_C], targetWorkKeys: [HREF_A, HREF_C]}
    }
    const records = runsChangeRecords(before, after)
    assert.deepEqual(persistedView(replay(before, records)), persistedView(after))
})

test('a record set replayed twice gives the same runs as once', () => {
    const before = {'run-1': {id: 'run-1', sourceType: 'space-feed', createdAt: 1, sourcePages: [], targetProfileHrefs: [HREF_A], targetWorkKeys: []}}
    const after = {'run-1': {...before['run-1'], targetProfileHrefs: [HREF_A, HREF_B], targetWorkKeys: [HREF_B]}}
    const records = runsChangeRecords(before, after)
    const once = replay(before, records)
    const twice = replay(once, records)
    assert.deepEqual(persistedView(twice), persistedView(once))
})

if (failed) {
    console.log(`${failed} runs test(s) failed`)
    process.exitCode = 1
}
