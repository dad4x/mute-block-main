// The batch nuke driver both batch pages run (27 Oct). The space page and the profile search page each send a batch of candidates to the
// queue, and the skeleton is the same on both: pick the queueable candidates, mark them as pending, press the button, send the batch, settle
// the marks from the reply, refresh the page's state, and finish the marks on every path. This module owns that skeleton. The DOM work and
// the page-only steps stay on the page, passed in as hooks: the space page's pre-filter breakdown, its mbQueueing dataset and post keys, and
// sweepBlockedProfileTabs; the search page's wait for the batch in the queue. The module does not touch the DOM.
//
// One run, in order:
//   1. queueItemOf(candidate) once per candidate. A falsy return is not queueable; any other value is the item to queue.
//   2. toWork(items) gives the work list. An empty work list ends the run with onEmpty(work).
//   3. beforeMark(work)          page-only state set before the marks.
//   4. onQueued(work.length)     the page's owned nuke status count.
//   5. marks.begin(markItems(work)) the batch is marked before its enqueue goes out.
//   6. try:
//        beforePress()
//        await pressButton()
//        setWorking('Queueing...')
//        afterWorking()
//        result = await sendBatch(work, onProgress)  onProgress sets 'Queueing... N of M' through setWorking
//        outcome = readOutcome(result, work)         {settled}; may be a promise (the search page asks the queue when a save timed out)
//        settled: marks.settle(batch, true), then refreshAfterEnqueue(work), and once it has answered: marks.release(batch), afterRelease()
//        not settled: marks.settle(batch, false)
//        return afterSettle(outcome, result, work)   the page's end of the run
//   7. finally: beforeFinish(), marks.finish(batch), afterFinish()
//
// A hook that returns a plain value is not awaited. Only a promise is, so the paths that did not await before still do not (the synthetic
// tests count microtask ticks on these paths).

'use strict'

const {formatQueueingLabel} = require('./candidateStatus')

function isThenable(value) {
    return !!value && typeof value.then === 'function'
}

async function runBatchNuke({
    candidates = [],
    queueItemOf,
    toWork = items => items,
    onEmpty,
    onQueued = () => {},
    beforeMark = () => {},
    markItems,
    marks,
    beforePress = () => {},
    pressButton,
    setWorking,
    afterWorking = () => {},
    sendBatch,
    readOutcome,
    refreshAfterEnqueue,
    afterRelease = () => {},
    afterSettle,
    beforeFinish = () => {},
    afterFinish = () => {}
} = {}) {
    const items = []
    for(const candidate of candidates) {
        const item = queueItemOf(candidate)
        if(item) items.push(item)
    }

    const work = toWork(items)
    if(!work.length) return onEmpty(work)

    beforeMark(work)
    onQueued(work.length)
    const batch = marks.begin(markItems(work))

    // The try starts before the press animation, so the finally runs on every path once the marks are set.
    try {
        beforePress()
        await pressButton()
        setWorking(formatQueueingLabel())
        afterWorking()

        const result = await sendBatch(work, (queuedSoFar, mergedSoFar, totalItems) => {
            const remaining = Math.max(0, totalItems - Math.min(totalItems, queuedSoFar + mergedSoFar))
            setWorking(formatQueueingLabel(remaining, totalItems))
        })
        let outcome = readOutcome(result, work)
        if(isThenable(outcome)) outcome = await outcome

        if(outcome.settled) {
            // The enqueue is durable, so the marks wait for a state reply asked from now on. They go once the worker has answered the refresh,
            // whatever it showed.
            marks.settle(batch, true)
            void refreshAfterEnqueue(work)
                .catch(() => false)
                .finally(() => {
                    marks.release(batch)
                    afterRelease()
                })
        }
        else {
            marks.settle(batch, false)
        }

        let value = afterSettle(outcome, result, work)
        if(isThenable(value)) value = await value
        return value
    }
    finally {
        beforeFinish()
        // A thrown enqueue never settled its marks: they go with it, as a failed enqueue does.
        marks.finish(batch)
        const done = afterFinish()
        if(isThenable(done)) await done
    }
}

module.exports = {runBatchNuke}
