const assert = require('node:assert/strict')
const {createQueueWalRecovery} = require('../shared/js/swQueueWalRecovery')

// Injected callbacks record what the recovery reports, so the test can check the counters and diagnostics.
function makeDeps(overrides = {}) {
    const metrics = []
    const diagnostics = []
    const deps = {
        normalizeMap: value => ({...(value || {})}),
        cloneValue: value => JSON.parse(JSON.stringify(value)),
        getJsonByteSize: value => JSON.stringify(value).length,
        incrementMetric: (name, by = 1) => metrics.push({kind: 'inc', name, by}),
        recordMetricMax: (name, value) => metrics.push({kind: 'max', name, value}),
        recordDiagnostic: (kind, message) => diagnostics.push({kind, message}),
        codecOptions: {},
        ...overrides
    }
    return {deps, metrics, diagnostics}
}

// A missing WAL store returns the snapshot queue and the missing-wal reason, with no counters.
{
    const {deps, metrics} = makeDeps()
    const recover = createQueueWalRecovery(deps)
    const result = recover({a: {href: 'a'}}, null)
    assert.equal(result.recovered, false)
    assert.equal(result.reason, 'missing-wal')
    assert.deepEqual(result.queue, {a: {href: 'a'}})
    assert.deepEqual(metrics, [])
}

// A failure thrown while replaying is caught: it counts the failure, reports a diagnostic, and returns the
// snapshot queue with the recovery-error reason.
{
    const {deps, metrics, diagnostics} = makeDeps({
        normalizeMap: value => value
    })
    const recover = createQueueWalRecovery(deps)
    // A store whose meta makes recoverProjectedState throw is not guaranteed by the WAL layer, so force the
    // throw through a getter on the store instead of depending on a particular corrupt shape.
    const walStore = {}
    Object.defineProperty(walStore, 'meta', {
        get() {
            throw new Error('store unreadable')
        }
    })
    const result = recover({}, walStore)
    assert.equal(result.recovered, false)
    assert.equal(result.reason, 'recovery-error')
    assert.equal(result.error, 'store unreadable')
    assert.deepEqual(metrics, [{kind: 'inc', name: 'coordinatorAuthority.queueWal.recoveryFailed', by: 1}])
    assert.deepEqual(diagnostics, [{kind: 'coordinator-authority-queue-wal-recovery-failed', message: 'store unreadable'}])
}

console.log('ok - queue WAL recovery reports missing-wal and recovery-error with the snapshot queue and counters')
