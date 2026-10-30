// The batch nuke driver both batch pages run (shared/js/candidateNuke.js). These tests drive runBatchNuke with a real enqueue-mark store
// (shared/js/candidateMarks.js) and logging hooks, so the order of the steps and the marks' state can be checked without a DOM. The page
// wiring of the hooks is pinned in test/p1-contract.test.js and exercised in test/swSynthetic.test.js.
const assert = require('node:assert/strict')
const {runBatchNuke} = require('../shared/js/candidateNuke')
const {createEnqueueMarkStore} = require('../shared/js/candidateMarks')

// A store keyed by the profile href, as the search page keeps one.
function makeStore() {
    return createEnqueueMarkStore({
        keyOf: mark => mark?.profileHref || '',
        matchOf: (row, mark) => !!row?.href && row.href === mark?.profileHref
    })
}

// Hooks that log every call, so a test can read the order of the steps. send and refresh return the promises the test controls.
function makeHarness({candidates = ['a', 'b', 'c'], queueable = () => true, sendResult = {durable: true, queued: 2}, sendError = null, outcomeSettles = true} = {}) {
    const log = []
    const store = makeStore()
    const seen = {queueItemCalls: [], work: null, progress: []}
    const sendGate = {}
    sendGate.promise = new Promise(resolve => { sendGate.resolve = resolve })
    const refreshGate = {}
    refreshGate.promise = new Promise(resolve => { refreshGate.resolve = resolve })
    const hooks = {
        candidates,
        queueItemOf: candidate => {
            seen.queueItemCalls.push(candidate)
            log.push(`queueItemOf:${candidate}`)
            return queueable(candidate) ? {href: candidate} : null
        },
        toWork: items => {
            log.push(`toWork:${items.map(item => item.href).join(',')}`)
            return items.map(item => item.href)
        },
        onEmpty: work => {
            log.push(`onEmpty:${work.length}`)
            return 'empty'
        },
        onQueued: count => log.push(`onQueued:${count}`),
        beforeMark: () => log.push('beforeMark'),
        markItems: work => work.map(profileHref => ({profileHref})),
        marks: store,
        beforePress: () => log.push('beforePress'),
        pressButton: async() => { log.push('press') },
        setWorking: text => log.push(`working:${text}`),
        afterWorking: () => log.push('afterWorking'),
        sendBatch: async(work, onProgress) => {
            seen.work = work
            log.push(`send:${work.join(',')}`)
            onProgress(1, 0, work.length)
            if(sendError) throw sendError
            return sendGate.promise
        },
        readOutcome: result => {
            log.push('readOutcome')
            return {settled: outcomeSettles && !!result?.durable, queued: result?.queued || 0}
        },
        refreshAfterEnqueue: work => {
            log.push(`refresh:${work.join(',')}`)
            return refreshGate.promise
        },
        afterRelease: () => log.push('afterRelease'),
        afterSettle: (outcome, result) => {
            log.push(`afterSettle:${outcome.settled}`)
            return outcome.settled ? 'queued' : 'nothing'
        },
        beforeFinish: () => log.push('beforeFinish'),
        afterFinish: () => log.push('afterFinish')
    }
    return {hooks, log, seen, store, sendGate, refreshGate}
}

const cases = []
function asyncTest(name, fn) {
    cases.push({name, fn})
}

asyncTest('runBatchNuke calls the queueable predicate once per candidate, in order, and keeps only the queueable items', async() => {
    const h = makeHarness({candidates: ['a', 'b', 'c'], queueable: candidate => candidate !== 'b'})
    h.sendGate.resolve({durable: true, queued: 2})
    await runBatchNuke(h.hooks)
    assert.deepEqual(h.seen.queueItemCalls, ['a', 'b', 'c'], 'one call per candidate, in order')
    assert.ok(h.log.includes('toWork:a,c'), 'only the queueable candidates reach the work list')
})

asyncTest('runBatchNuke marks the batch before the send, holds it while the send is in flight, and settles it when the send resolves', async() => {
    const h = makeHarness({candidates: ['a', 'b']})
    const running = runBatchNuke(h.hooks)
    // Let the run reach the send. The batch is marked and still queueing, so its keys read as queueing.
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(h.store.hasBatches(), true, 'the batch is marked before the enqueue returns')
    assert.equal(h.store.stateOf('a'), 'queueing')
    assert.equal(h.store.stateOf('b'), 'queueing')

    h.sendGate.resolve({durable: true, queued: 2})
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(h.store.stateOf('a'), 'nuking', 'a durable enqueue settles the batch, so its keys read as nuking')
    assert.ok(h.log.includes('refresh:a,b'), 'the page state is refreshed for the batch')

    h.refreshGate.resolve(true)
    const value = await running
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(value, 'queued', 'the page end is returned')
    assert.equal(h.store.hasBatches(), false, 'the marks are released once the refresh has answered')
    assert.equal(h.store.stateOf('a'), '')
})

asyncTest('runBatchNuke releases the marks when the send throws, and the error reaches the caller', async() => {
    const h = makeHarness({candidates: ['a'], sendError: new Error('enqueue failed')})
    await assert.rejects(runBatchNuke(h.hooks), /enqueue failed/)
    assert.equal(h.store.hasBatches(), false, 'a thrown enqueue leaves no marks')
    assert.equal(h.store.stateOf('a'), '')
    assert.ok(h.log.includes('beforeFinish') && h.log.includes('afterFinish'), 'the finally hooks run on the throw')
    assert.ok(!h.log.some(entry => entry.startsWith('refresh:')), 'no refresh is asked for a batch that never settled')
})

asyncTest('runBatchNuke drops an unsettled batch at once when the enqueue reports no durable queue, and asks no refresh', async() => {
    const h = makeHarness({candidates: ['a'], outcomeSettles: false})
    h.sendGate.resolve({durable: false, queued: 0})
    const value = await runBatchNuke(h.hooks)
    assert.equal(value, 'nothing')
    assert.equal(h.store.hasBatches(), false)
    assert.ok(!h.log.some(entry => entry.startsWith('refresh:')))
})

asyncTest('runBatchNuke ends with onEmpty, and marks nothing, when no candidate is queueable', async() => {
    const h = makeHarness({candidates: ['a', 'b'], queueable: () => false})
    const value = await runBatchNuke(h.hooks)
    assert.equal(value, 'empty')
    assert.equal(h.store.hasBatches(), false)
    assert.deepEqual(h.log, ['queueItemOf:a', 'queueItemOf:b', 'toWork:', 'onEmpty:0'])
})

asyncTest('runBatchNuke runs the page hooks in order: queue, work, count, mark, press, send, settle, refresh, page end, finish', async() => {
    const h = makeHarness({candidates: ['a']})
    h.sendGate.resolve({durable: true, queued: 1})
    h.refreshGate.resolve(true)
    await runBatchNuke(h.hooks)
    // afterRelease runs once the refresh has answered, which is after the page end (the refresh is not awaited by the run).
    await new Promise(resolve => setImmediate(resolve))
    const expected = [
        'queueItemOf:a',
        'toWork:a',
        'beforeMark',
        'onQueued:1',
        'beforePress',
        'press',
        'working:Queueing...',
        'afterWorking',
        'send:a',
        'working:Queueing...',
        'readOutcome',
        'refresh:a',
        'afterSettle:true',
        'beforeFinish',
        'afterFinish',
        'afterRelease'
    ]
    assert.deepEqual(h.log, expected)
})

asyncTest('runBatchNuke counts the queued batch after the page marks its state, and before the batch is marked', async() => {
    const h = makeHarness({candidates: ['a']})
    h.sendGate.resolve({durable: true, queued: 1})
    h.refreshGate.resolve(true)
    await runBatchNuke(h.hooks)
    assert.ok(h.log.indexOf('beforeMark') < h.log.indexOf('onQueued:1'), 'the page sets its state first, then the count')
})

asyncTest('runBatchNuke turns the send progress into the Queueing label, counting what is still to queue', async() => {
    const labels = []
    const h = makeHarness({candidates: ['a', 'b', 'c']})
    h.hooks.setWorking = text => labels.push(text)
    h.hooks.sendBatch = async(work, onProgress) => {
        onProgress(1, 1, 3)
        onProgress(2, 1, 3)
        return {durable: true, queued: 3}
    }
    h.refreshGate.resolve(true)
    await runBatchNuke(h.hooks)
    // Pressed: 'Queueing...'. The first chunk settled with 1 queued and 1 merged, so 1 of 3 is still to go. The second leaves none.
    assert.deepEqual(labels, ['Queueing...', 'Queueing... 1 of 3', 'Queueing...'])
})

asyncTest('runBatchNuke awaits a page hook that returns a promise, and passes the outcome of a read that waits', async() => {
    const h = makeHarness({candidates: ['a']})
    h.hooks.readOutcome = () => Promise.resolve({settled: true, queued: 4})
    h.hooks.afterSettle = async(outcome) => `waited:${outcome.queued}`
    h.refreshGate.resolve(true)
    h.sendGate.resolve({durable: true, queued: 0})
    const value = await runBatchNuke(h.hooks)
    assert.equal(value, 'waited:4')
})

async function runAll() {
    for(const {name, fn} of cases) {
        try {
            await fn()
            console.log(`ok - ${name}`)
        }
        catch(error) {
            console.error(`not ok - ${name}`)
            throw error
        }
    }
    console.log('candidateNuke tests passed')
}

runAll().catch(error => {
    console.error(error)
    process.exitCode = 1
})
