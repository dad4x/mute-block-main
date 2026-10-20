const assert = require('node:assert/strict')
const {QUEUE_READ_METHODS, createQueueWalReadFacade} = require('../shared/js/swQueueWal')

// One delegate per method. Each records its name and arguments and returns its own sentinel, so the test can
// check the arguments that arrived and that the facade returns the delegate's exact result.
function makeDelegates() {
    const calls = []
    const deps = {}
    const sentinels = {}
    for (const name of QUEUE_READ_METHODS) {
        const sentinel = {sentinel: name}
        sentinels[name] = sentinel
        deps[name] = (...args) => {
            calls.push({name, args})
            return sentinel
        }
    }
    return {calls, deps, sentinels}
}

// The facade exposes exactly the methods the reader has always had, plus the group B projections.
assert.deepEqual(
    [...QUEUE_READ_METHODS].sort(),
    [
        'actionRows', 'completedRecent', 'completedRow', 'currentAuthority', 'full', 'item', 'reconcile', 'row', 'rows',
        'runs', 'runsEvents', 'runsEventsProgress', 'runsPending',
        'runsProgress', 'runsProgressPendingNuked', 'runsScopedProgress',
        'runsScopedProgressForMutation'
    ]
)

// Every method delegates with its arguments unchanged and returns the delegate's exact result.
{
    const {calls, deps, sentinels} = makeDelegates()
    const facade = createQueueWalReadFacade(deps)
    for (const name of QUEUE_READ_METHODS) {
        assert.equal(typeof facade[name], 'function', `${name} is a function`)
    }
    assert.equal(facade.full({metricPath: 'x'}), sentinels.full)
    assert.equal(facade.runs(), sentinels.runs)
    assert.equal(facade.currentAuthority({}, {profileHrefs: ['h']}), sentinels.currentAuthority)
    assert.equal(facade.row('k', {metricPath: 'r'}), sentinels.row)
    assert.equal(facade.rows(['a', 'b'], {metricPath: 'rs'}), sentinels.rows)
    assert.equal(facade.item('k', {metricPath: 'i'}), sentinels.item)
    assert.equal(facade.actionRows('from', {tabAction: 'open'}), sentinels.actionRows)
    assert.deepEqual(calls, [
        {name: 'full', args: [{metricPath: 'x'}]},
        {name: 'runs', args: []},
        {name: 'currentAuthority', args: [{}, {profileHrefs: ['h']}]},
        {name: 'row', args: ['k', {metricPath: 'r'}]},
        {name: 'rows', args: [['a', 'b'], {metricPath: 'rs'}]},
        {name: 'item', args: ['k', {metricPath: 'i'}]},
        {name: 'actionRows', args: ['from', {tabAction: 'open'}]}
    ])
}

// Each group B projection reaches its own delegate, not another one.
{
    const {calls, deps, sentinels} = makeDelegates()
    const facade = createQueueWalReadFacade(deps)
    assert.equal(facade.runsEvents({metricPath: 'e'}), sentinels.runsEvents)
    assert.equal(facade.runsEventsProgress({metricPath: 'ep'}), sentinels.runsEventsProgress)
    assert.equal(facade.runsPending({metricPath: 'p'}), sentinels.runsPending)
    assert.equal(facade.runsProgressPendingNuked({metricPath: 'n'}), sentinels.runsProgressPendingNuked)
    assert.equal(facade.runsScopedProgress({metricPath: 's'}), sentinels.runsScopedProgress)
    assert.equal(facade.runsScopedProgressForMutation({metricPath: 'm'}), sentinels.runsScopedProgressForMutation)
    assert.deepEqual(calls.map(call => call.name), [
        'runsEvents', 'runsEventsProgress', 'runsPending',
        'runsProgressPendingNuked', 'runsScopedProgress', 'runsScopedProgressForMutation'
    ])
}

// A missing delegate fails when the facade is built, and names the method.
{
    const {deps} = makeDelegates()
    delete deps.runsPending
    assert.throws(
        () => createQueueWalReadFacade(deps),
        /no delegate for "runsPending"/
    )
}

// A rejection from a delegate reaches the caller as the same promise.
{
    const failure = new Error('storage unavailable')
    const rejected = Promise.reject(failure)
    rejected.catch(() => {})
    const {deps} = makeDelegates()
    deps.row = () => rejected
    assert.equal(createQueueWalReadFacade(deps).row('k'), rejected)
}

console.log('ok - queue read facade delegates each read unchanged and fails fast on a missing delegate')
