// The generic 'map.appendUnique' record kind in the shared log engine: a list field of a map entry grows by the values it does not hold yet.
// It is used for the runs' target lists. Tests use the engine directly, without the worker.
const assert = require('node:assert/strict')
const {applyWalRecord, validateWalRecord} = require('../shared/js/walSnapshotStore')

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

function append(state, seq, values, extra = {}) {
    const result = applyWalRecord(state, {
        seq,
        kind: 'map.appendUnique',
        area: 'runs',
        key: 'run-1',
        field: 'targetProfileHrefs',
        values,
        ...extra
    }, {appliedIds: new Set(), ownedAreas: new Set()})
    return result
}

test('values are appended in the order given, with no repeats', () => {
    let state = {runs: {'run-1': {id: 'run-1', targetProfileHrefs: ['a']}}}
    const first = append(state, 1, ['b', 'a', 'c'])
    assert.equal(first.applied, true)
    state = first.state
    assert.deepEqual(state.runs['run-1'].targetProfileHrefs, ['a', 'b', 'c'])
    const second = append(state, 2, ['c', 'd'])
    assert.equal(second.applied, true)
    assert.deepEqual(second.state.runs['run-1'].targetProfileHrefs, ['a', 'b', 'c', 'd'])
})

test('a record that adds nothing is not applied and leaves the state as it was', () => {
    const state = {runs: {'run-1': {id: 'run-1', targetProfileHrefs: ['a', 'b']}}}
    const result = append(state, 3, ['a', 'b'])
    assert.equal(result.applied, false)
    assert.equal(result.reason, 'nothing-new')
    assert.equal(result.state, state)
})

test('replaying the same record twice gives the same list as once', () => {
    const record = {seq: 4, kind: 'map.appendUnique', area: 'runs', key: 'run-1', field: 'targetProfileHrefs', values: ['x', 'y']}
    const applied = new Set()
    const once = applyWalRecord({runs: {}}, record, {appliedIds: applied, ownedAreas: new Set()})
    const again = applyWalRecord(once.state, record, {appliedIds: applied, ownedAreas: new Set()})
    assert.deepEqual(again.state.runs['run-1'].targetProfileHrefs, ['x', 'y'])
})

test('a record for a key that does not exist yet creates the entry', () => {
    const result = append({runs: {}}, 5, ['p'])
    assert.equal(result.applied, true)
    assert.deepEqual(result.state.runs['run-1'], {targetProfileHrefs: ['p']})
})

test('other fields of the entry are kept', () => {
    const state = {runs: {'run-1': {id: 'run-1', sourceType: 'space-feed', targetProfileHrefs: []}}}
    const result = append(state, 6, ['q'])
    assert.equal(result.state.runs['run-1'].sourceType, 'space-feed')
    assert.deepEqual(result.state.runs['run-1'].targetProfileHrefs, ['q'])
})

test('a record without a field or a list of values is rejected', () => {
    assert.equal(validateWalRecord({seq: 1, id: 'r1', kind: 'map.appendUnique', area: 'runs', key: 'k', values: []}).reason, 'missing-field')
    assert.equal(validateWalRecord({seq: 1, id: 'r2', kind: 'map.appendUnique', area: 'runs', key: 'k', field: 'f'}).reason, 'missing-values')
    assert.equal(validateWalRecord({seq: 1, id: 'r3', kind: 'map.appendUnique', area: 'runs', key: 'k', field: 'f', values: ['v']}).ok, true)
})

test('non-string and empty values are not added', () => {
    const result = append({runs: {}}, 7, ['', 3, null, 'ok'])
    assert.deepEqual(result.state.runs['run-1'].targetProfileHrefs, ['ok'])
})

if (failed) {
    console.log(`${failed} map.appendUnique test(s) failed`)
    process.exitCode = 1
}
