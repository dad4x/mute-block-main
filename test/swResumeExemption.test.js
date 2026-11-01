// The progress resume exemption (review F2; coder decision 30, 18 Oct). A save that writes only progress keys does not start queued
// work. The decision is made from the keys a write carries, not from its label. A storage update with any non-progress write is not
// exempt, even if it also writes progress. Tests the pure module, then the idle latch's decision for a progress-only update and a
// mixed one.
const assert = require('node:assert/strict')
const {
    isProgressStorageKey,
    classifyStorageWriteForResume,
    applyResumeExemptionToUpdate
} = require('../shared/js/swResumeExemption')
const {createStorageIdlePromiseLatch} = require('../shared/js/swStorageIdlePromiseLatch')

// The key names are the worker's: the progress view key and the shard prefix. The tests pass them in, as the worker does.
const KEY_NAMES = {viewKey: 'mbProfileNukeProgressView', shardPrefix: 'mbProfileNukeProgressShard.'}
const SHARD = 'mbProfileNukeProgressShard.0a'
const VIEW = 'mbProfileNukeProgressView'
const RUNS = 'mbCoordinatorRuns'
const OUTLIERS = 'mbCoordinatorOutliers'

// The progress save labels from the review table (historical/progress-path-review-2026-10-18.md, section 3). A label names the save; it does not
// decide the exemption, so each label below must be exempt when its write carries only progress keys.
const PROGRESS_LABELS = [
    'reconcile.nonProfileLanding.progressProjection',
    'reconcile.profileRedirectMismatch.progressProjection',
    'reconcile.activeWithoutActor.progressProjection',
    'terminalProgress.inline.progressProjection',
    'reconcile.progressProjection',
    'terminalSettlement.derived.progressProjection',
    'failedRetry.progressProjectionTombstone',
    'failedRequeue.progressProjectionTombstone',
    'enqueue.progressProjection',
    'clearProfile.progressProjectionTombstone',
    'rowEvent.queued-progress-milestone.projection',
    'directProgress.inline.progressProjection',
    'directProfileProgress.save',
    'contentPageState.rebuild.missing-projection',
]

const tests = []
function test(name, fn) {
    tests.push({name, fn})
}

test('a progress key is the view or one of the shards, and nothing else', () => {
    assert.equal(isProgressStorageKey(VIEW, KEY_NAMES), true)
    assert.equal(isProgressStorageKey(SHARD, KEY_NAMES), true)
    assert.equal(isProgressStorageKey(RUNS, KEY_NAMES), false)
    assert.equal(isProgressStorageKey(OUTLIERS, KEY_NAMES), false)
})

test('a write with only progress keys is progress-only, whatever its label (decision 30)', () => {
    for (const label of PROGRESS_LABELS) {
        // The label is a name only: the classification takes the keys and nothing else.
        const write = classifyStorageWriteForResume([VIEW, SHARD], KEY_NAMES)
        assert.equal(write.progressOnly, true, `exempt under ${label}`)
        assert.equal(write.nonProgress, false, `no non-progress key under ${label}`)
    }
    assert.equal(classifyStorageWriteForResume([SHARD], KEY_NAMES).progressOnly, true)
})

test('a write with a non-progress key is not exempt, even when it also writes progress (decision 30)', () => {
    const mixed = classifyStorageWriteForResume([SHARD, RUNS], KEY_NAMES)
    assert.equal(mixed.wroteProgress, true)
    assert.equal(mixed.progressOnly, false)
    assert.equal(mixed.nonProgress, true)
    const other = classifyStorageWriteForResume([OUTLIERS], KEY_NAMES)
    assert.equal(other.wroteProgress, false)
    assert.equal(other.nonProgress, true)
})

test('a write with no keys changes nothing', () => {
    const empty = classifyStorageWriteForResume([], KEY_NAMES)
    assert.deepEqual(empty, {wroteProgress: false, progressOnly: false, nonProgress: false})
    const context = {}
    applyResumeExemptionToUpdate(context, empty)
    assert.deepEqual(context, {})
})

test('a progress-only write suppresses the durable resume for its update, and counts the exempt write', () => {
    const context = {}
    applyResumeExemptionToUpdate(context, classifyStorageWriteForResume([SHARD], KEY_NAMES))
    assert.equal(context.suppressDurableIdleResume, true)
    assert.equal(context.profileProgressProjectionOnlyWrites, 1)
    assert.notEqual(context.nonProgressProjectionWrite, true)
    applyResumeExemptionToUpdate(context, classifyStorageWriteForResume([VIEW], KEY_NAMES))
    assert.equal(context.profileProgressProjectionOnlyWrites, 2)
    assert.equal(context.suppressDurableIdleResume, true)
})

test('a non-progress write in the same update clears the suppression, and a later progress-only write does not set it again', () => {
    const context = {}
    applyResumeExemptionToUpdate(context, classifyStorageWriteForResume([SHARD], KEY_NAMES))
    applyResumeExemptionToUpdate(context, classifyStorageWriteForResume([RUNS], KEY_NAMES))
    assert.equal(context.suppressDurableIdleResume, false, 'the non-progress write clears the suppression')
    assert.equal(context.nonProgressProjectionWrite, true)
    applyResumeExemptionToUpdate(context, classifyStorageWriteForResume([VIEW], KEY_NAMES))
    assert.equal(context.suppressDurableIdleResume, false, 'a progress-only write after non-progress work does not suppress')
})

test('a mixed write (progress and a non-progress key in one payload) clears the suppression as well', () => {
    const context = {}
    applyResumeExemptionToUpdate(context, classifyStorageWriteForResume([VIEW], KEY_NAMES))
    applyResumeExemptionToUpdate(context, classifyStorageWriteForResume([SHARD, RUNS], KEY_NAMES))
    assert.equal(context.suppressDurableIdleResume, false)
    assert.equal(context.nonProgressProjectionWrite, true)
})

// The latch's decision (recordStorageIdleChurnCounters) with the write flags an update leaves behind. Its dependencies that the
// decision does not use are stubbed; the resume scheduler is a spy.
function makeLatchWithSpy() {
    const scheduled = []
    // The latch reads its runtime and its resume scheduler from the handler group, and its state from the state group.
    const handlers = new Proxy({
        queueRuntime: {getRuntimeCounts: () => ({activeQueuedTabs: 0, queuedTabActions: 0, pendingTabActions: 0})},
        scheduleDurableQueueResumeFromIdleStorage: context => { scheduled.push(context); return true }
    }, {get: (target, key) => (key in target ? target[key] : () => {})})
    const deps = new Proxy({handlers, state: {}}, {get: (target, key) => (key in target ? target[key] : () => {})})
    const latch = createStorageIdlePromiseLatch(deps)
    return {latch, scheduled}
}

test('the idle latch schedules no resume for a progress-only update (decision 30)', () => {
    const {latch, scheduled} = makeLatchWithSpy()
    const context = {durableActiveRows: 1, durableQueuedRows: 0, paused: false}
    applyResumeExemptionToUpdate(context, classifyStorageWriteForResume([SHARD], KEY_NAMES))
    latch.recordStorageIdleChurnCounters(context)
    assert.equal(scheduled.length, 0)
})

test('the idle latch schedules the resume for a mixed update (decision 30)', () => {
    const {latch, scheduled} = makeLatchWithSpy()
    const context = {durableActiveRows: 1, durableQueuedRows: 0, paused: false}
    applyResumeExemptionToUpdate(context, classifyStorageWriteForResume([SHARD], KEY_NAMES))
    applyResumeExemptionToUpdate(context, classifyStorageWriteForResume([RUNS], KEY_NAMES))
    latch.recordStorageIdleChurnCounters(context)
    assert.equal(scheduled.length, 1)
})

test('a progress-only update with no durable work also schedules nothing, and a paused queue schedules nothing (existing rules kept)', () => {
    const {latch, scheduled} = makeLatchWithSpy()
    const idle = {durableActiveRows: 0, durableQueuedRows: 0, paused: false}
    applyResumeExemptionToUpdate(idle, classifyStorageWriteForResume([VIEW], KEY_NAMES))
    latch.recordStorageIdleChurnCounters(idle)
    const paused = {durableActiveRows: 1, durableQueuedRows: 0, paused: true}
    latch.recordStorageIdleChurnCounters(paused)
    assert.equal(scheduled.length, 0)
})

test('a suppression the caller set when the update started is kept by a non-progress write (the recovered-queue path)', () => {
    const context = {suppressDurableIdleResume: true}
    applyResumeExemptionToUpdate(context, classifyStorageWriteForResume([RUNS], KEY_NAMES))
    assert.equal(context.suppressDurableIdleResume, true, 'the caller asked for the suppression, and a queue write does not cancel it')
    assert.equal(context.nonProgressProjectionWrite, true)
})

test('a progress-only write in a caller-suppressed update does not claim the suppression, so a later queue write cannot clear it', () => {
    const context = {suppressDurableIdleResume: true}
    applyResumeExemptionToUpdate(context, classifyStorageWriteForResume([SHARD], KEY_NAMES))
    applyResumeExemptionToUpdate(context, classifyStorageWriteForResume([RUNS], KEY_NAMES))
    assert.equal(context.suppressDurableIdleResume, true)
    assert.equal(context.progressResumeExempt, undefined)
})

test('the idle latch schedules no resume for a caller-suppressed update that then writes queue state', () => {
    const {latch, scheduled} = makeLatchWithSpy()
    const context = {durableActiveRows: 1, durableQueuedRows: 0, paused: false, suppressDurableIdleResume: true}
    applyResumeExemptionToUpdate(context, classifyStorageWriteForResume([RUNS], KEY_NAMES))
    latch.recordStorageIdleChurnCounters(context)
    assert.equal(scheduled.length, 0)
})

let failed = 0
;(async () => {
    for (const {name, fn} of tests) {
        try {
            await fn()
            console.log(`ok - ${name}`)
        }
        catch (error) {
            failed += 1
            console.log(`not ok - ${name}`)
            console.log(error?.stack || error)
        }
    }
    if (failed) {
        console.log(`${failed} resume exemption test(s) failed`)
        process.exitCode = 1
    }
})()
