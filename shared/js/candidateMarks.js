// The enqueue marks a page holds: the batches it has just sent to the queue, shown on its rows and in its toolbar until the worker's
// state reply catches up. The space page and the profile search page each create one store and keep their own marks in it. No state is
// shared between two stores.
//
// A batch is {items, settledAt, running}. Each item is a mark the page built, identified by keyOf(mark).
//   - begin(items) marks a batch before its enqueue goes out. A batch with no items is not kept.
//   - settle(batch, true) records that the enqueue is durable (settledAt). settle(batch, false) drops the batch: the enqueue failed.
//   - finish(batch) is called once the enqueue has returned, success or failure. A batch no durable enqueue settled goes at once.
//   - release(batch) drops whatever marks of the batch are left, once the post-enqueue state refresh has answered (or failed).
//   - applyToStateReply(requestedAt, askedKeys, rows) takes a state reply's rows. For each settled batch, a mark goes when a row matches it
//     (matchOf(row, mark)), or when the reply was asked after the batch settled and askedKeys names keyOf(mark). A batch still queueing is
//     kept whole: its rows are not due in any reply yet.
//   - stateOf(key) is 'nuking' when a settled batch holds a mark with that key, 'queueing' when only a batch still in flight does, '' otherwise.
//   - batches() returns a copy of the list of batches. hasBatches() tells whether any batch is held.
//
// keyOf and matchOf are supplied by the page. Each store calls onChange (if given) after every change, so the page can clear its own caches.
// Marks are never stored: a reload clears them, and the worker's rows take over.

'use strict'

function createEnqueueMarkStore({keyOf, matchOf, onChange = null} = {}) {
    if(typeof keyOf !== 'function') throw new TypeError('createEnqueueMarkStore: keyOf must be a function')
    if(typeof matchOf !== 'function') throw new TypeError('createEnqueueMarkStore: matchOf must be a function')

    let batches = []

    function touch() {
        if(typeof onChange === 'function') onChange()
    }

    function begin(items = []) {
        // running: the batch's enqueue has not returned yet (see finish).
        const batch = {items: Array.isArray(items) ? items : [], settledAt: 0, running: true}
        if(batch.items.length) batches.push(batch)
        touch()
        return batch
    }

    // settled true: the enqueue is durable, so the marks wait for a state reply asked from now on. settled false: the enqueue failed, so the marks go.
    function settle(batch = null, settled = false) {
        if(!batch) return
        if(settled) batch.settledAt = Date.now()
        else batches = batches.filter(item => item !== batch)
        touch()
    }

    // Once every send of the batch has returned. A settled batch keeps its marks until release.
    function finish(batch = null) {
        if(!batch) return
        batch.running = false
        if(!batch.settledAt) settle(batch, false)
        else touch()
    }

    // The batch is looked up by identity, so a batch the reply trimmed in place is still found here.
    function release(batch = null) {
        if(!batch) return
        batches = batches.filter(item => item !== batch)
        touch()
    }

    function applyToStateReply(requestedAt = 0, askedKeys = [], rows = []) {
        if(!batches.length) return

        const asked = new Set(askedKeys)
        const rowList = Array.isArray(rows) ? rows : []
        for(const batch of batches) {
            // A batch still queueing is kept whole: its enqueue has not settled, so its rows are not due in any reply yet.
            if(!(batch.settledAt > 0)) continue
            const askedAfterSettle = requestedAt >= batch.settledAt
            // Trimmed in place by assignment to batch.items, so the batch reference its enqueue holds still matches when it is released.
            batch.items = batch.items.filter(mark => !(
                rowList.some(row => matchOf(row, mark)) ||
                (askedAfterSettle && asked.has(keyOf(mark)))
            ))
        }
        batches = batches.filter(batch => batch.items.length)
        touch()
    }

    function stateOf(key = '') {
        const holding = batches.filter(batch => batch.items.some(mark => keyOf(mark) === key))
        if(holding.some(batch => batch.settledAt > 0)) return 'nuking'
        return holding.length ? 'queueing' : ''
    }

    return {
        begin,
        settle,
        finish,
        release,
        applyToStateReply,
        stateOf,
        batches: () => batches.slice(),
        hasBatches: () => batches.length > 0
    }
}

module.exports = {createEnqueueMarkStore}
