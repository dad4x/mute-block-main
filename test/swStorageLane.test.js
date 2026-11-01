// Storage update lane diagnostics (owner, 17 Oct): every update leaves one flight-recorder entry with its reason label and times, and a
// timeout names the lane's holder and runs the stall check. Fake timers, so a forced delay is exact.
const assert = require('node:assert/strict')
const {createSerializedStorageUpdateQueue, createSerializedStorageUpdateState} = require('../shared/js/swstorage')

function makeLane(overrides = {}) {
    const timers = []
    const events = []
    const stallChecks = []
    let clock = 1000
    const lane = createSerializedStorageUpdateQueue({
        state: createSerializedStorageUpdateState(),
        setTimeout: (fn, ms) => {
            const timer = {fn, ms}
            timers.push(timer)
            return timer
        },
        clearTimeout: timer => {
            const index = timers.indexOf(timer)
            if(index >= 0) timers.splice(index, 1)
        },
        now: () => clock,
        defaultTimeoutMs: 1000,
        getQueueSnapshot: () => ({
            currentReason: 'holder-reason',
            currentPhase: 'running',
            currentStartedAt: 900,
            currentEnqueuedAt: 800,
            depth: 2,
            oldestWaitMs: 4000,
            currentRunMs: 100,
            timedOut: 0
        }),
        onTimeoutStallCheck: reason => stallChecks.push(reason),
        recordEvent: entry => events.push(entry),
        ...overrides
    })
    return {lane, timers, events, stallChecks, advance: ms => { clock += ms }}
}

const tick = () => new Promise(resolve => setImmediate(resolve))

async function testCompletedUpdateRecordsOneSettledEntry() {
    const harness = makeLane()
    const result = await harness.lane.enqueue(() => 'written', {reason: 'unit-completed', timeoutMs: 5000})
    assert.equal(result, 'written')
    const settled = harness.events.filter(entry => entry.kind === 'storage-update')
    assert.equal(settled.length, 1)
    assert.equal(settled[0].outcome, 'completed')
    assert.equal(settled[0].reason, 'unit-completed')
    assert.equal(settled[0].timeoutMs, 5000)
    assert.ok(settled[0].enqueuedAt > 0)
    assert.ok(settled[0].startedAt >= settled[0].enqueuedAt)
    assert.ok(settled[0].finishedAt >= settled[0].startedAt)
    assert.deepEqual(harness.stallChecks, [])
    assert.equal(harness.timers.length, 0)
}

async function testForcedDelayTimesOutAndNamesTheHolder() {
    const harness = makeLane()
    const pending = harness.lane.enqueue(() => new Promise(() => {}), {reason: 'unit-forced-delay', timeoutMs: 2000})
    assert.equal(harness.timers.length, 1)
    assert.equal(harness.timers[0].ms, 2000)
    // Let the update start, so the timeout lands on a running update, not one that was never begun.
    await tick()
    harness.advance(2000)
    harness.timers[0].fn()
    assert.equal(await pending, false)

    const timeouts = harness.events.filter(entry => entry.kind === 'storage-update-timeout')
    assert.equal(timeouts.length, 1)
    assert.equal(timeouts[0].reason, 'unit-forced-delay')
    assert.equal(timeouts[0].timeoutMs, 2000)
    assert.equal(timeouts[0].currentPhase, 'running')
    assert.equal(timeouts[0].holderReason, 'holder-reason')
    assert.equal(timeouts[0].holderPhase, 'running')
    assert.equal(timeouts[0].holderStartedAt, 900)
    assert.equal(timeouts[0].oldestWaitMs, 4000)
    assert.equal(timeouts[0].depth, 2)
    assert.deepEqual(harness.stallChecks, ['unit-forced-delay-timeout'])
    // The body never finished, so no completed entry exists for it yet.
    assert.equal(harness.events.filter(entry => entry.kind === 'storage-update').length, 0)
}

async function testThrowingUpdateRecordsAFailedEntry() {
    const harness = makeLane()
    const result = await harness.lane.enqueue(() => {
        throw new Error('unit-boom')
    }, {reason: 'unit-failed', timeoutMs: 5000})
    assert.equal(result, false)
    const settled = harness.events.filter(entry => entry.kind === 'storage-update')
    assert.equal(settled.length, 1)
    assert.equal(settled[0].outcome, 'failed')
    assert.equal(settled[0].reason, 'unit-failed')
    assert.deepEqual(harness.stallChecks, [])
}

const tests = [
    ['completed update records one settled entry', testCompletedUpdateRecordsOneSettledEntry],
    ['forced delay times out and names the holder', testForcedDelayTimesOutAndNamesTheHolder],
    ['throwing update records a failed entry', testThrowingUpdateRecordsAFailedEntry]
]

;(async () => {
    let failed = 0
    for(const [name, fn] of tests) {
        try {
            await fn()
            console.log(`ok - ${name}`)
        }
        catch(error) {
            failed += 1
            console.log(`not ok - ${name}`)
            console.log(error)
        }
    }
    if(failed) {
        process.exitCode = 1
        throw new Error(`${failed} swStorageLane test${failed === 1 ? '' : 's'} failed`)
    }
})()
