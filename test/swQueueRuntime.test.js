const assert = require('node:assert/strict')
const {
    createQueueRuntimeState
} = require('../shared/js/swqueueRuntime')

function test(name, fn) {
    try {
        fn()
        console.log(`ok - ${name}`)
    }
    catch(error) {
        console.error(`not ok - ${name}`)
        throw error
    }
}

// Entropy-reduction Phase 7 audit (see
// entropy-reduction-action-plan-2026-09-09.md item 7): getOrderedQueueItems
// is meant to be the cheap alternative to a raw Object.entries(queue) scan.
// These tests lock in both its ordering/staleness-fallback correctness and
// the fast-path optimization that skips the redundant leftover-key scan
// when the index is fully fresh.

test('getOrderedQueueItems returns items in queueSequence order per rebuildQueueOrder', () => {
    const runtime = createQueueRuntimeState()
    const queue = {
        a: {queueSequence: 3},
        b: {queueSequence: 1},
        c: {queueSequence: 2}
    }
    runtime.rebuildQueueOrder(queue)

    const items = runtime.getOrderedQueueItems(queue)
    assert.deepEqual(items.map(([key]) => key), ['b', 'c', 'a'])
    assert.equal(items[0][1], queue.b)
})

test('getOrderedQueueItems skips the redundant leftover-key scan when the index is fully fresh', () => {
    const runtime = createQueueRuntimeState()
    const queue = {
        a: {queueSequence: 3},
        b: {queueSequence: 1},
        c: {queueSequence: 2}
    }
    runtime.rebuildQueueOrder(queue)

    const originalEntries = Object.entries
    let entriesCallCount = 0
    Object.entries = (...args) => {
        entriesCallCount += 1
        return originalEntries(...args)
    }
    let items
    try {
        items = runtime.getOrderedQueueItems(queue)
    }
    finally {
        Object.entries = originalEntries
    }

    assert.deepEqual(items.map(([key]) => key), ['b', 'c', 'a'])
    assert.equal(entriesCallCount, 0, 'fully fresh index should not re-scan the queue via Object.entries')
})

test('getOrderedQueueItems still finds keys added to queue after the index was built (stale index)', () => {
    const runtime = createQueueRuntimeState()
    const queue = {
        a: {queueSequence: 1}
    }
    runtime.rebuildQueueOrder(queue)

    // Simulate a caller working from a queue that gained a row without a
    // round-trip through refreshResidentCoordinatorAuthorityState/
    // rebuildQueueOrder.
    queue.freshlyAdded = {queueSequence: 2}

    const items = runtime.getOrderedQueueItems(queue)
    assert.deepEqual(items.map(([key]) => key).sort(), ['a', 'freshlyAdded'].sort())
    assert.equal(items[items.length - 1][0], 'freshlyAdded')
})

test('getOrderedQueueItems silently drops index keys no longer present in queue (stale index)', () => {
    const runtime = createQueueRuntimeState()
    const queue = {
        a: {queueSequence: 1},
        b: {queueSequence: 2}
    }
    runtime.rebuildQueueOrder(queue)

    delete queue.a

    const items = runtime.getOrderedQueueItems(queue)
    assert.deepEqual(items.map(([key]) => key), ['b'])
})

test('getOrderedQueueItems on an empty queue returns an empty list without rebuilding', () => {
    const runtime = createQueueRuntimeState()
    assert.deepEqual(runtime.getOrderedQueueItems({}), [])
    assert.deepEqual(runtime.getOrderedQueueItems(), [])
})
