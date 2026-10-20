const assert = require('node:assert/strict')
const {createQueueWalDurableReads} = require('../shared/js/swQueueWalDurableReads')

// An empty authority: the resident state is loaded, holds no rows and no completed log, and is not paused. The metric
// read is a spy: the reads answer from the resident state, so it must never be called (P2).
function makeReads() {
    const calls = []
    const residentCalls = []
    const reads = createQueueWalDurableReads({
        metricStorageGet: async (defaults, options) => {
            calls.push(options.metricPath)
            return {}
        },
        getResidentState: async () => {
            residentCalls.push(true)
            return {completed: {}, queue: {}, paused: false}
        },
        queueWalStore: {
            loadStoreFromStorage: async () => null
        },
        getCoordinatorQueueWalStorageDefaults: () => ({}),
        normalizeCoordinatorMap: value => value || {},
        sortCompletedWorkRowsNewestFirst: (map = {}, limit = 50) => Object.values(map).slice(0, limit),
        recoverCoordinatorQueueFromWal: () => ({queue: {}}),
        runQueueWakeupMetricPhase: (name, fn) => fn(),
        hasStoredCoordinatorWork: () => false,
        COORDINATOR_QUEUE_WAL_SNAPSHOT_CODEC_OPTIONS: {codec: null},
        COORDINATOR_PAUSED_KEY: 'mbCoordinatorPaused'
    })
    return {reads, calls, residentCalls}
}

async function main() {
    const {reads, calls, residentCalls} = makeReads()

    assert.deepEqual(await reads.getRecentCompletedWorkRows(), [])
    assert.equal(await reads.findCompletedWorkRowByKey('https://example.test/a'), null)
    assert.equal(await reads.hasUnpausedStoredCoordinatorWorkInDurableQueue('test'), false)
    assert.deepEqual(calls, [])
    assert.equal(residentCalls.length, 3)

    assert.throws(
        () => createQueueWalDurableReads({}),
        /Missing queue WAL durable reads dependency/
    )
}

main().then(() => console.log('swQueueWalDurableReads tests passed'))
