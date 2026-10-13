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

test('noteOrderedQueueKeyPresent moves an existing key to the back', () => {
    const runtime = createQueueRuntimeState()
    const queue = {
        a: {queueSequence: 1},
        b: {queueSequence: 2},
        c: {queueSequence: 3}
    }
    runtime.rebuildQueueOrder(queue)
    assert.deepEqual(runtime.getOrderedQueueKeys(), ['a', 'b', 'c'])

    const result = runtime.noteOrderedQueueKeyPresent('b')
    assert.equal(result, true)
    assert.deepEqual(runtime.getOrderedQueueKeys(), ['a', 'c', 'b'])
})

test('noteOrderedQueueKeyPresent adds new keys at the back', () => {
    const runtime = createQueueRuntimeState()
    const queue = {
        a: {queueSequence: 1},
        b: {queueSequence: 2}
    }
    runtime.rebuildQueueOrder(queue)
    assert.deepEqual(runtime.getOrderedQueueKeys(), ['a', 'b'])

    const result = runtime.noteOrderedQueueKeyPresent('newKey')
    assert.equal(result, true)
    assert.deepEqual(runtime.getOrderedQueueKeys(), ['a', 'b', 'newKey'])
})

test('noteOrderedQueueKeyPresent returns false for empty/invalid keys', () => {
    const runtime = createQueueRuntimeState()
    runtime.rebuildQueueOrder({})

    assert.equal(runtime.noteOrderedQueueKeyPresent(''), false)
    assert.equal(runtime.noteOrderedQueueKeyPresent(null), false)
    assert.equal(runtime.noteOrderedQueueKeyPresent('   '), false)
    assert.deepEqual(runtime.getOrderedQueueKeys(), [])
})

test('noteOrderedQueueKeyAbsent removes a key', () => {
    const runtime = createQueueRuntimeState()
    const queue = {
        a: {queueSequence: 1},
        b: {queueSequence: 2},
        c: {queueSequence: 3}
    }
    runtime.rebuildQueueOrder(queue)
    assert.deepEqual(runtime.getOrderedQueueKeys(), ['a', 'b', 'c'])

    const result = runtime.noteOrderedQueueKeyAbsent('b')
    assert.equal(result, true)
    assert.deepEqual(runtime.getOrderedQueueKeys(), ['a', 'c'])
})

test('noteOrderedQueueKeyAbsent is idempotent on keys never present', () => {
    const runtime = createQueueRuntimeState()
    runtime.rebuildQueueOrder({})

    const result1 = runtime.noteOrderedQueueKeyAbsent('never-existed')
    const result2 = runtime.noteOrderedQueueKeyAbsent('never-existed')

    assert.equal(result1, false)
    assert.equal(result2, false)
    assert.deepEqual(runtime.getOrderedQueueKeys(), [])
})

test('noteOrderedQueueKeyAbsent is idempotent on already-removed keys', () => {
    const runtime = createQueueRuntimeState()
    const queue = {
        a: {queueSequence: 1},
        b: {queueSequence: 2}
    }
    runtime.rebuildQueueOrder(queue)

    const result1 = runtime.noteOrderedQueueKeyAbsent('a')
    const result2 = runtime.noteOrderedQueueKeyAbsent('a')

    assert.equal(result1, true)
    assert.equal(result2, false)
    assert.deepEqual(runtime.getOrderedQueueKeys(), ['b'])
})

test('noteOrderedQueueKeyAbsent returns false for empty/invalid keys', () => {
    const runtime = createQueueRuntimeState()
    const queue = {
        a: {queueSequence: 1}
    }
    runtime.rebuildQueueOrder(queue)

    assert.equal(runtime.noteOrderedQueueKeyAbsent(''), false)
    assert.equal(runtime.noteOrderedQueueKeyAbsent(null), false)
    assert.equal(runtime.noteOrderedQueueKeyAbsent('   '), false)
    assert.deepEqual(runtime.getOrderedQueueKeys(), ['a'])
})

test('getOrderedQueueKeyCount reflects the index size without allocating an array', () => {
    const runtime = createQueueRuntimeState()
    assert.equal(runtime.getOrderedQueueKeyCount(), 0)

    runtime.rebuildQueueOrder({a: {queueSequence: 1}, b: {queueSequence: 2}})
    assert.equal(runtime.getOrderedQueueKeyCount(), 2)

    runtime.noteOrderedQueueKeyAbsent('a')
    assert.equal(runtime.getOrderedQueueKeyCount(), 1)
})

// syncOrderedQueueKeysFromQueueDiff (2026-09-26): replaces rebuildQueueOrder's
// full O(n log n) sort on sw.js's one call site (refreshResidentCoordinatorAuthorityState)
// with an O(n) diff against the queue the index was last synced to, using
// noteOrderedQueueKeyPresent/Absent for just the keys that actually changed.
test('syncOrderedQueueKeysFromQueueDiff adds newly-enqueued keys at the back without touching unchanged keys', () => {
    const runtime = createQueueRuntimeState()
    const previousQueue = {
        a: {queueSequence: 1},
        b: {queueSequence: 2}
    }
    runtime.rebuildQueueOrder(previousQueue)
    assert.deepEqual(runtime.getOrderedQueueKeys(), ['a', 'b'])

    const nextQueue = {
        ...previousQueue,
        c: {queueSequence: 3}
    }
    runtime.syncOrderedQueueKeysFromQueueDiff(previousQueue, nextQueue)
    assert.deepEqual(runtime.getOrderedQueueKeys(), ['a', 'b', 'c'])
})

test('syncOrderedQueueKeysFromQueueDiff removes keys no longer in the queue (terminal departure)', () => {
    const runtime = createQueueRuntimeState()
    const previousQueue = {
        a: {queueSequence: 1},
        b: {queueSequence: 2},
        c: {queueSequence: 3}
    }
    runtime.rebuildQueueOrder(previousQueue)

    const nextQueue = {a: previousQueue.a, c: previousQueue.c}
    runtime.syncOrderedQueueKeysFromQueueDiff(previousQueue, nextQueue)
    assert.deepEqual(runtime.getOrderedQueueKeys(), ['a', 'c'])
})

test('syncOrderedQueueKeysFromQueueDiff moves a key to the back when its queueSequence bumps (retry-to-queued)', () => {
    const runtime = createQueueRuntimeState()
    const previousQueue = {
        a: {queueSequence: 1},
        b: {queueSequence: 2},
        c: {queueSequence: 3}
    }
    runtime.rebuildQueueOrder(previousQueue)
    assert.deepEqual(runtime.getOrderedQueueKeys(), ['a', 'b', 'c'])

    const nextQueue = {
        ...previousQueue,
        a: {queueSequence: 4}
    }
    runtime.syncOrderedQueueKeysFromQueueDiff(previousQueue, nextQueue)
    assert.deepEqual(runtime.getOrderedQueueKeys(), ['b', 'c', 'a'])
})

test('syncOrderedQueueKeysFromQueueDiff handles simultaneous add, remove, and requeue in one diff', () => {
    const runtime = createQueueRuntimeState()
    const previousQueue = {
        a: {queueSequence: 1},
        b: {queueSequence: 2},
        c: {queueSequence: 3}
    }
    runtime.rebuildQueueOrder(previousQueue)

    // b terminalizes and leaves, a gets retried (sequence bump, moves to
    // back), d is a brand new enqueue -- all landing in the same refresh.
    const nextQueue = {
        a: {queueSequence: 4},
        c: previousQueue.c,
        d: {queueSequence: 5}
    }
    runtime.syncOrderedQueueKeysFromQueueDiff(previousQueue, nextQueue)
    assert.deepEqual(runtime.getOrderedQueueKeys(), ['c', 'a', 'd'])
})
