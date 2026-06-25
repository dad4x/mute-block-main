const assert = require('node:assert/strict')

const {
    appendWalRecordsToGeneration,
    buildSegmentedWalStoragePayload,
    makePairedCheckpointStore
} = require('../shared/js/walSnapshotStore')
const {
    selectFailedItems
} = require('../tools/cdp/requeue-failures')

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

function buildWalPayloadWithFailedRow(href = 'https://www.quora.com/profile/White-Morphius') {
    let store = makePairedCheckpointStore({queue: {}, runs: {}, progress: {}, events: []}, {
        snapshotSeq: 10,
        nextSeq: 11
    })
    store = appendWalRecordsToGeneration(store, [{
        kind: 'map.patch',
        area: 'queue',
        key: href,
        patch: {
            status: 'failed',
            targetProfileHref: href,
            coordinatorKey: `profile:${href}`,
            finalError: 'direct profile miss'
        }
    }]).store
    return buildSegmentedWalStoragePayload(store, {baseKey: 'mbCoordinatorQueueWal'})
}

test('selects WAL-recovered failed rows when raw queue is empty', () => {
    const staleHref = 'https://www.quora.com/profile/Elon-Musk-Space-5'
    const liveHref = 'https://www.quora.com/profile/White-Morphius'
    const selected = selectFailedItems({
        mbCoordinatorQueue: {},
        mbCoordinatorQueueView: {
            items: [{
                status: 'failed',
                storageKey: staleHref,
                targetProfileHref: staleHref
            }]
        },
        ...buildWalPayloadWithFailedRow(liveHref)
    }, {needle: 'White-Morphius', limit: 1})

    assert.equal(selected.source, 'wal-recovered-authority')
    assert.equal(selected.recovered, true)
    assert.equal(selected.rawQueueRows, 0)
    assert.equal(selected.selectedItems.length, 1)
    assert.equal(selected.selectedItems[0].profileHref, liveHref)
    assert.equal(selected.selectedItems.some(item => item.profileHref === staleHref), false)
})

test('does not select compact-only failures when durable authority is empty', () => {
    const staleHref = 'https://www.quora.com/profile/Ly-Chen-29'
    const selected = selectFailedItems({
        mbCoordinatorQueue: {},
        mbCoordinatorQueueView: {
            items: [{
                status: 'failed',
                storageKey: staleHref,
                targetProfileHref: staleHref
            }]
        }
    }, {needle: 'Ly-Chen-29', limit: 1})

    assert.equal(selected.source, 'raw-queue')
    assert.equal(selected.recovered, false)
    assert.equal(selected.reason, 'missing-wal')
    assert.equal(selected.selectedItems.length, 0)
    assert.equal(selected.compactFailedMatches, 1)
    assert.equal(selected.compactIgnored, true)
})

test('falls back only to raw queue rows when WAL is absent', () => {
    const rawHref = 'https://www.quora.com/profile/AD-Firms-Business-Services'
    const selected = selectFailedItems({
        mbCoordinatorQueue: {
            [rawHref]: {
                status: 'failed',
                targetProfileHref: rawHref
            }
        },
        mbCoordinatorQueueView: {
            items: [{
                status: 'failed',
                targetProfileHref: 'https://www.quora.com/profile/Elon-Musk-Space-5'
            }]
        }
    }, {needle: 'AD-Firms-Business-Services'})

    assert.equal(selected.source, 'raw-queue')
    assert.equal(selected.selectedItems.length, 1)
    assert.equal(selected.selectedItems[0].profileHref, rawHref)
})
