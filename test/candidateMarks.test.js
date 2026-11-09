// The enqueue-mark store both batch pages use (shared/js/candidateMarks.js). Each page creates one store; these tests cover the store's own
// rules with plain marks, and pin that content.js creates its two stores from it. The page keys and matches are tested in swSynthetic.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const {createEnqueueMarkStore} = require('../shared/js/candidateMarks')

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

// A plain mark is {href}: it is keyed by its href, and a row matches a mark when the row's href is the mark's href.
const keyOf = mark => mark.href
const matchOf = (row, mark) => row.href === mark.href

test('touch then begin: the page cache is cleared, and the batch holds its marks at once as queueing', () => {
    let touches = 0
    const store = createEnqueueMarkStore({keyOf, matchOf, onChange: () => { touches += 1 }})
    const batch = store.begin([{href: 'A'}, {href: 'B'}])

    assert.equal(batch.running, true)
    assert.equal(batch.settledAt, 0)
    assert.equal(store.batches().length, 1)
    assert.equal(store.stateOf('A'), 'queueing')
    assert.equal(store.stateOf('C'), '', 'a key outside the batch is not marked')
    assert.ok(touches >= 1, 'begin clears the page caches through onChange')

    // A batch with no marks is not kept, and the store still reports nothing held.
    store.begin([])
    assert.equal(store.batches().length, 1)
    assert.equal(store.hasBatches(), true)
})

test('settle keeps the marks until a state reply shows their rows, and a reply from before the settle does not clear them', () => {
    const store = createEnqueueMarkStore({keyOf, matchOf})
    const batch = store.begin([{href: 'A'}, {href: 'B'}])
    store.settle(batch, true)
    assert.equal(store.stateOf('A'), 'nuking', 'a settled batch shows as nuking')

    // A reply asked before the settle, even one that names A, says nothing about the batch: the marks stay.
    store.applyToStateReply(batch.settledAt - 1, ['A'], [])
    assert.equal(store.stateOf('A'), 'nuking')
    assert.equal(store.stateOf('B'), 'nuking')

    // A reply asked after the settle that shows A's row clears A only. B is neither shown nor asked, so it stays.
    store.applyToStateReply(batch.settledAt + 1, [], [{href: 'A'}])
    assert.equal(store.stateOf('A'), '')
    assert.equal(store.stateOf('B'), 'nuking')
    assert.equal(store.batches().length, 1)
})

test('a reply asked after the settle drops a marked key it does not show, and an unsettled batch is kept whole by any reply', () => {
    const store = createEnqueueMarkStore({keyOf, matchOf})
    const running = store.begin([{href: 'R'}])
    // A reply with no rows, asked while the enqueue is still running, keeps the running batch.
    store.applyToStateReply(Date.now(), ['R'], [])
    assert.equal(store.stateOf('R'), 'queueing', 'a batch still queueing is not due in any reply')

    store.settle(running, true)
    store.applyToStateReply(running.settledAt + 1, ['R'], [])
    assert.equal(store.stateOf('R'), '', 'asked after the settle and not shown: the mark goes')
    assert.equal(store.batches().length, 0, 'an emptied batch is dropped from the list')
})

test('finish keeps a settled batch until release; an unsettled batch that finishes goes at once', () => {
    const store = createEnqueueMarkStore({keyOf, matchOf})
    const durable = store.begin([{href: 'A'}])
    store.settle(durable, true)
    store.finish(durable)
    assert.equal(durable.running, false)
    assert.equal(store.stateOf('A'), 'nuking', 'the marks stay until the refresh answers')

    store.release(durable)
    assert.equal(store.stateOf('A'), '', 'release drops the marks left')
    assert.equal(store.batches().length, 0)

    const failed = store.begin([{href: 'B'}])
    store.finish(failed)
    assert.equal(failed.running, false)
    assert.equal(store.stateOf('B'), '', 'a batch no durable enqueue settled goes when it finishes')
    assert.equal(store.batches().length, 0)
})

test('release drops a batch at once, whatever state it is in, and settle false drops the marks of a failed enqueue at once', () => {
    const store = createEnqueueMarkStore({keyOf, matchOf})
    const settled = store.begin([{href: 'A'}])
    store.settle(settled, true)
    store.release(settled)
    assert.equal(store.stateOf('A'), '', 'release drops a settled batch at once')

    const failed = store.begin([{href: 'B'}])
    store.settle(failed, false)
    assert.equal(store.stateOf('B'), '', 'a failed enqueue leaves no marks')
    assert.equal(store.batches().length, 0)

    // The batch that a state reply trimmed in place is still found by identity on release.
    const trimmed = store.begin([{href: 'C'}, {href: 'D'}])
    store.settle(trimmed, true)
    store.applyToStateReply(trimmed.settledAt + 1, [], [{href: 'C'}])
    assert.equal(store.batches().length, 1, 'D is still marked, so the batch is held')
    store.release(trimmed)
    assert.equal(store.batches().length, 0, 'release finds the trimmed batch by identity')
})

test('the apply step uses the page matchOf to match rows with marks, and a row of the other kind does not match', () => {
    // A post mark has no profile yet and is matched by a post key in the row's evidence. A profile mark is matched by the row's href only.
    const postPageKeyOf = mark => mark.profileHref || mark.postKey
    const postPageMatchOf = (row, mark) => mark.profileHref ? row.href === mark.profileHref : row.postKeys.has(mark.postKey)
    const store = createEnqueueMarkStore({keyOf: postPageKeyOf, matchOf: postPageMatchOf})
    const batch = store.begin([{profileHref: 'P1', postKey: 'post-a'}, {profileHref: '', postKey: 'post-b'}])
    store.settle(batch, true)

    // A row that names post-a by evidence does not clear the profile mark of P1 (matched by href only).
    store.applyToStateReply(batch.settledAt + 1, [], [{href: '', postKeys: new Set(['post-a'])}])
    assert.equal(store.stateOf('P1'), 'nuking', 'a profile mark is not matched by a post key')

    // A row for P1 clears that mark. A row with post-b in its evidence clears the post mark.
    store.applyToStateReply(batch.settledAt + 2, [], [{href: 'P1', postKeys: new Set()}])
    assert.equal(store.stateOf('P1'), '')
    assert.equal(store.stateOf('post-b'), 'nuking', 'the post mark stays until a row names its post key')
    store.applyToStateReply(batch.settledAt + 3, [], [{href: '', postKeys: new Set(['post-b'])}])
    assert.equal(store.batches().length, 0)
})

test('the store passes each row and mark to the page matchOf', () => {
    const calls = []
    const store = createEnqueueMarkStore({
        keyOf,
        matchOf: (row, mark) => {
            calls.push([row, mark])
            return row.href === mark.href
        }
    })
    const batch = store.begin([{href: 'A'}])
    store.settle(batch, true)
    const row = {href: 'Z'}
    store.applyToStateReply(batch.settledAt + 1, [], [row])
    assert.equal(calls.length, 1)
    assert.equal(calls[0][0], row)
    assert.equal(calls[0][1], batch.items[0], 'the mark is passed as the second argument')
    assert.equal(store.stateOf('A'), 'nuking', 'an unmatched row keeps the mark')
})

test('two stores do not share state: a batch in one store is not seen by the other, and a reply to one does not change the other', () => {
    const one = createEnqueueMarkStore({keyOf, matchOf})
    const two = createEnqueueMarkStore({keyOf, matchOf})

    const batch = one.begin([{href: 'A'}])
    one.settle(batch, true)
    assert.equal(one.batches().length, 1)
    assert.equal(two.batches().length, 0, 'the second store holds nothing')
    assert.equal(two.stateOf('A'), '')

    // The second store holds its own settled mark for the same key. A reply to it clears its mark and leaves the first store's mark alone.
    const own = two.begin([{href: 'A'}])
    two.settle(own, true)
    assert.equal(two.stateOf('A'), 'nuking')
    two.applyToStateReply(own.settledAt + 1, [], [{href: 'A'}])
    assert.equal(two.stateOf('A'), '', 'the reply clears the second store\'s mark')
    assert.equal(one.stateOf('A'), 'nuking', 'the first store keeps its own mark')
    assert.equal(one.batches().length, 1)
})

test('batches() returns a copy of the list, so a caller cannot change the store by editing it', () => {
    const store = createEnqueueMarkStore({keyOf, matchOf})
    store.begin([{href: 'A'}])
    const list = store.batches()
    list.pop()
    assert.equal(store.batches().length, 1)
    assert.equal(store.hasBatches(), true)
})

test('the store needs keyOf and matchOf as functions', () => {
    assert.throws(() => createEnqueueMarkStore({matchOf}), TypeError)
    assert.throws(() => createEnqueueMarkStore({keyOf}), TypeError)
})

test('content.js creates its two mark stores from this module, and no page-level mark list is left', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'shared', 'js', 'content.js'), 'utf8')
    assert.match(content, /^const \{createEnqueueMarkStore\} = require\('\.\/candidateMarks'\)$/m)
    assert.match(content, /^const spaceFeedEnqueueMarks = createEnqueueMarkStore\(\{keyOf: spaceFeedEnqueueMarkKeyOf, matchOf: spaceFeedEnqueueMarkMatchOf, onChange: touchSpaceFeedEnqueueMarks\}\)$/m)
    assert.match(content, /^const profileSearchEnqueueMarks = createEnqueueMarkStore\(\{keyOf: profileSearchEnqueueMarkKeyOf, matchOf: profileSearchEnqueueMarkMatchOf\}\)$/m)
    assert.doesNotMatch(content, /EnqueueMarkBatches/, 'the page-level batch lists are replaced by the stores')
})

console.log('candidate marks store tests passed')
