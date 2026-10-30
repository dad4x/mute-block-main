const assert = require('node:assert/strict')
const {makeQueueWalRowShardTail, shardIdOf, SHARD_ID_DEFAULT} = require('../shared/js/swQueueWalRowShard')

function test(name, fn) {
    return Promise.resolve().then(fn).then(() => console.log(`ok - ${name}`), error => {
        console.error(`not ok - ${name}`)
        throw error
    })
}

const BUDGET = 400

function queuedRow(id, extra = {}) {
    return {status: 'queued', attemptId: `attempt-${id}`, attemptNumber: 1, profileHref: `https://www.quora.com/profile/Row-${id}`, ...extra}
}

async function main() {
    await test('with the switch off, a row is returned as it was given and gets no shard', async () => {
        const tail = makeQueueWalRowShardTail({budgetBytes: BUDGET, enabled: false})
        const row = queuedRow(1)
        assert.equal(tail.stamp(null, row), row, 'the same object comes back')
        assert.equal(row.shard, undefined)
    })

    await test('an enqueue goes to the tail shard, and the shard is written into the row', async () => {
        const tail = makeQueueWalRowShardTail({budgetBytes: BUDGET, enabled: true})
        const stamped = tail.stamp(null, queuedRow(1))
        assert.equal(stamped.shard, SHARD_ID_DEFAULT)
        assert.equal(tail.tailState().id, 0)
        assert.ok(tail.tailState().bytes > 0)
    })

    await test('a full tail rolls over, and older shards keep their rows', async () => {
        const tail = makeQueueWalRowShardTail({budgetBytes: BUDGET, enabled: true})
        const shards = []
        for (let id = 0; id < 30; id += 1) shards.push(tail.stamp(null, queuedRow(id)).shard)
        assert.equal(shards[0], 0)
        assert.ok(shards[shards.length - 1] > 0, 'later enqueues start later shards')
        // Shard ids never go down while enqueues only add rows.
        for (let index = 1; index < shards.length; index += 1) assert.ok(shards[index] >= shards[index - 1])
    })

    await test('a single row bigger than the budget still takes a shard of its own, and the next row starts a new one', async () => {
        const tail = makeQueueWalRowShardTail({budgetBytes: 50, enabled: true})
        const big = tail.stamp(null, queuedRow(1, {note: 'x'.repeat(200)}))
        const next = tail.stamp(null, queuedRow(2))
        assert.equal(big.shard, 0)
        assert.equal(next.shard, 1)
    })

    await test('a retry moves a row from its old shard to the tail, with its new attempt', async () => {
        const tail = makeQueueWalRowShardTail({budgetBytes: BUDGET, enabled: true})
        const old = {...queuedRow(1), status: 'failed', shard: 0, attemptId: 'attempt-1', attemptNumber: 1}
        for (let id = 2; id < 30; id += 1) tail.stamp(null, queuedRow(id))
        const tailId = tail.tailState().id
        const retried = tail.stamp(old, {...queuedRow(1), attemptId: 'attempt-2', attemptNumber: 2, shard: 0})
        assert.equal(retried.shard, tailId)
        assert.equal(retried.attemptNumber, 2)
    })

    await test('progress on a queued row with the same attempt does not move it', async () => {
        const tail = makeQueueWalRowShardTail({budgetBytes: BUDGET, enabled: true})
        const first = tail.stamp(null, queuedRow(1))
        for (let id = 2; id < 30; id += 1) tail.stamp(null, queuedRow(id))
        const again = tail.stamp(first, {...first, lastProgressAt: 99})
        assert.equal(again.shard, first.shard)
    })

    await test('a completion keeps the row in its shard, so the head shrinks without a move', async () => {
        const tail = makeQueueWalRowShardTail({budgetBytes: BUDGET, enabled: true})
        const queued = tail.stamp(null, queuedRow(1))
        for (let id = 2; id < 30; id += 1) tail.stamp(null, queuedRow(id))
        const done = tail.stamp(queued, {...queued, status: 'succeeded', terminalAt: 5})
        assert.equal(done.shard, queued.shard)
        assert.equal(tail.tailState().id > 0, true, 'the tail did not move back')
    })

    await test('a row without a shard counts as shard 0 for the partition, and a non-queued row inherits its previous shard', async () => {
        assert.equal(shardIdOf({status: 'queued'}), SHARD_ID_DEFAULT)
        assert.equal(shardIdOf({shard: -1}), SHARD_ID_DEFAULT)
        assert.equal(shardIdOf({shard: 3}), 3)
        const tail = makeQueueWalRowShardTail({budgetBytes: BUDGET, enabled: true})
        const inherited = tail.stamp({status: 'active', shard: 4}, {status: 'active'})
        assert.equal(inherited.shard, 4)
    })

    await test('rebuild takes the tail from rows that already carry their shards', async () => {
        const tail = makeQueueWalRowShardTail({budgetBytes: BUDGET, enabled: true})
        const rows = {
            'https://www.quora.com/profile/A': {status: 'succeeded', shard: 0, attemptId: 'a'},
            'https://www.quora.com/profile/B': {status: 'queued', shard: 2, attemptId: 'b', note: 'y'.repeat(60)},
            'https://www.quora.com/profile/C': {status: 'queued', shard: 2, attemptId: 'c'}
        }
        const state = tail.rebuild(rows)
        assert.equal(state.id, 2)
        assert.equal(state.bytes, JSON.stringify(rows['https://www.quora.com/profile/B']).length + JSON.stringify(rows['https://www.quora.com/profile/C']).length)
        const next = tail.stamp(null, queuedRow(9))
        assert.equal(next.shard, 2, 'a new enqueue fills the rebuilt tail first')
    })

    await test('a no-op on a row with no shard comes back unchanged, with no shard field added', async () => {
        const tail = makeQueueWalRowShardTail({budgetBytes: BUDGET, enabled: true})
        const row = {status: 'active', attemptId: 'attempt-noop', attemptNumber: 2, updatedAt: 4000}
        const back = tail.stamp(row, {...row})
        assert.deepEqual(back, row)
        assert.equal('shard' in back, false)
        const queued = {status: 'queued', attemptId: 'attempt-q', attemptNumber: 1}
        assert.equal('shard' in tail.stamp(queued, {...queued}), false, 'a queued progress on a shardless row adds no shard either')
    })

    await test('shardOf reads the row shard, and the default for a missing shard is 0', async () => {
        const tail = makeQueueWalRowShardTail({budgetBytes: BUDGET, enabled: true})
        assert.equal(tail.shardOf('queue', 'k', {shard: 7}), 7)
        assert.equal(tail.shardOf('completed', 'k', {status: 'succeeded'}), 0)
    })

    await test('the switch is read on each call, so a change applies to the next stamp', async () => {
        let on = false
        const tail = makeQueueWalRowShardTail({budgetBytes: BUDGET, isEnabled: () => on})
        assert.equal('shard' in tail.stamp(null, queuedRow(1)), false, 'off: no shard')
        on = true
        assert.equal(tail.stamp(null, queuedRow(2)).shard, 0, 'on: the next stamp carries a shard')
        on = false
        assert.equal('shard' in tail.stamp(null, queuedRow(3)), false, 'off again: no shard')
    })

    console.log('queue row shards: all tests ran')
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
