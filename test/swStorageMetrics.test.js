const assert = require('node:assert/strict')
const {createStorageMetrics} = require('../shared/js/swStorageMetrics')

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

const COORDINATOR_QUEUE_KEY = 'mbCoordinatorQueue'

function makeMetrics() {
    const counters = {}
    const maxCounters = {}
    const details = {}
    const metrics = createStorageMetrics({
        constants: {
            COORDINATOR_QUEUE_KEY,
            COORDINATOR_QUEUE_WAL_KEY: 'mbCoordinatorQueueWal',
            COORDINATOR_QUEUE_VIEW_KEY: 'mbCoordinatorQueueView',
            COORDINATOR_CONTENT_QUEUE_INDEX_KEY: 'mbCoordinatorContentQueueIndex',
            COORDINATOR_CONTENT_SOURCE_INDEX_PREFIX: 'mbCoordinatorContentSourceIndex.',
            COORDINATOR_RUNS_KEY: 'mbCoordinatorRuns',
            COORDINATOR_EVENTS_KEY: 'mbCoordinatorEvents',
            QUEUE_WAKEUP_METRICS_VIEW_KEY: 'mbQueueWakeupMetricsView',
            PROFILE_NUKE_PROGRESS_VIEW_KEY: 'mbProfileNukeProgressView',
            PROFILE_NUKE_PROGRESS_SHARD_PREFIX: 'mbProfileNukeProgressShard.',
            SPACE_PENDING_NUKED_POSTS_KEY: 'mbSpacePendingNukedPosts',
            SPACE_NUKED_POSTS_KEY: 'mbSpaceNukedPosts',
            OWNED_TAB_STATE_KEY: 'mbOwnedTabState',
            COORDINATOR_PAUSED_KEY: 'mbCoordinatorPaused',
            COORDINATOR_PAUSE_GENERATION_KEY: 'mbCoordinatorPauseGeneration',
            COORDINATOR_TAB_KEY: 'mbCoordinatorTab',
            QUEUE_WAKEUP_METRICS_KEY: 'mbQueueWakeupMetrics'
        },
        handlers: {
            incrementQueueWakeupMetric(name, amount = 1) {
                counters[name] = (counters[name] || 0) + amount
            },
            recordQueueWakeupMetricMax(name, value) {
                maxCounters[name] = Math.max(maxCounters[name] || 0, value)
            },
            incrementActiveStorageMetricDetail(name, amount = 1) {
                details[name] = (details[name] || 0) + amount
            },
            setActiveStorageMetricDetail(name, value) {
                details[name] = value
            },
            getActiveStorageContext() {
                return null
            }
        },
        state: {
            getSnapshotObserver: () => null
        }
    })
    return {metrics, counters, maxCounters, details}
}

function makeLargeQueue(rowCount = 50) {
    const queue = {}
    for(let index = 0; index < rowCount; index += 1) {
        queue[`https://www.quora.com/profile/${index}`] = {status: 'queued', attemptNumber: 1}
    }
    return queue
}

test('recordStoragePayloadMetrics + recordQueueWriteOperationMetrics stringify the queue only once', () => {
    const {metrics, counters} = makeMetrics()
    const queue = makeLargeQueue()

    const originalStringify = JSON.stringify
    let queueStringifyCalls = 0
    JSON.stringify = function(value, ...rest) {
        if(value === queue) queueStringifyCalls += 1
        return originalStringify(value, ...rest)
    }
    try {
        metrics.recordStoragePayloadMetrics({[COORDINATOR_QUEUE_KEY]: queue}, 'test.path')
        metrics.recordQueueWriteOperationMetrics({[COORDINATOR_QUEUE_KEY]: queue}, {queueOperation: 'enqueue'})
    }
    finally {
        JSON.stringify = originalStringify
    }

    assert.equal(queueStringifyCalls, 1, 'queue should be JSON.stringified only once across both metric recorders')
    assert.ok(counters['storagePayload.write.queue.bytes'] > 0)
    assert.equal(counters['storagePayload.write.queue.bytes'], counters['queueWrite.operation.enqueue.bytes'])
})

test('the cache is single-use: a second call to recordQueueWriteOperationMetrics without a fresh recordStoragePayloadMetrics call recomputes correctly', () => {
    const {metrics, counters} = makeMetrics()
    const queue = makeLargeQueue()

    metrics.recordStoragePayloadMetrics({[COORDINATOR_QUEUE_KEY]: queue}, 'test.path')
    metrics.recordQueueWriteOperationMetrics({[COORDINATOR_QUEUE_KEY]: queue}, {queueOperation: 'enqueue'})
    const firstBytes = counters['queueWrite.operation.enqueue.bytes']

    // The slot was consumed (and cleared) by the call above, so calling
    // recordQueueWriteOperationMetrics again on its own (no matching
    // recordStoragePayloadMetrics call immediately before it) must fall
    // back to computing fresh rather than reusing a stale/absent entry.
    metrics.recordQueueWriteOperationMetrics({[COORDINATOR_QUEUE_KEY]: queue}, {queueOperation: 'enqueue'})
    const secondBytes = counters['queueWrite.operation.enqueue.bytes'] - firstBytes

    assert.equal(secondBytes, firstBytes)
})

test('a cache miss (different queue object) still computes correct, independent byte sizes', () => {
    const {metrics, counters} = makeMetrics()
    const queueA = makeLargeQueue(5)
    const queueB = makeLargeQueue(50)

    // Simulate two independent metricStorageSet calls back-to-back with
    // different queue objects (the normal case, since the coordinator
    // replaces the queue wholesale on every mutation) -- the cache must not
    // let a stale byte count from queueA leak into queueB's metrics.
    metrics.recordStoragePayloadMetrics({[COORDINATOR_QUEUE_KEY]: queueA}, 'test.path')
    metrics.recordQueueWriteOperationMetrics({[COORDINATOR_QUEUE_KEY]: queueA}, {queueOperation: 'enqueue'})
    const bytesA = counters['queueWrite.operation.enqueue.bytes']

    metrics.recordStoragePayloadMetrics({[COORDINATOR_QUEUE_KEY]: queueB}, 'test.path')
    metrics.recordQueueWriteOperationMetrics({[COORDINATOR_QUEUE_KEY]: queueB}, {queueOperation: 'enqueue'})
    const bytesB = counters['queueWrite.operation.enqueue.bytes'] - bytesA

    assert.ok(bytesA > 0 && bytesB > 0)
    assert.ok(bytesB > bytesA, 'the larger queue must report a larger byte size, not a cached smaller one')
})
