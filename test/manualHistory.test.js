const assert = require('node:assert/strict')
const manual = require('../shared/js/swManualHistory')

function test(name, fn) {
    return Promise.resolve().then(fn).then(() => console.log(`ok - ${name}`), error => {
        console.error(`not ok - ${name}`)
        throw error
    })
}

const HREF = 'https://www.quora.com/profile/Manual-Person'
const AT = 1700000000000

async function main() {
    await test('a manual block is a succeeded blocked row, marked manual, with the profile and the time', async () => {
        const row = manual.makeManualHistoryRow({kind: 'block', profileHref: HREF, at: AT})
        assert.equal(row.status, 'succeeded')
        assert.equal(row.outcome, 'blocked')
        assert.equal(row.actionKind, manual.MANUAL_BLOCK_ACTION_KIND)
        assert.equal(row.origin, manual.MANUAL_ORIGIN)
        assert.equal(row.targetProfileHref, HREF)
        assert.equal(row.terminalAt, AT)
    })

    await test('a pardon is a succeeded unblocked row with the unblock-unmute action kind', async () => {
        const row = manual.makeManualHistoryRow({kind: 'pardon', profileHref: HREF, at: AT + 1000})
        assert.equal(row.status, 'succeeded')
        assert.equal(row.outcome, 'unblocked')
        assert.equal(row.actionKind, manual.PARDON_ACTION_KIND)
        assert.equal(row.actionKind, 'unblock-unmute')
    })

    await test('a block and the pardon after it are two rows, with two different keys', async () => {
        const block = manual.makeManualHistoryRow({kind: 'block', profileHref: HREF, at: AT})
        const pardon = manual.makeManualHistoryRow({kind: 'pardon', profileHref: HREF, at: AT + 1000})
        assert.notEqual(block.coordinatorKey, pardon.coordinatorKey)
        assert.ok(block.coordinatorKey.startsWith(manual.MANUAL_HISTORY_KEY_PREFIX))
    })

    await test('an unknown kind, a missing profile, or a bad time gives no row', async () => {
        assert.equal(manual.makeManualHistoryRow({kind: 'nope', profileHref: HREF, at: AT}), null)
        assert.equal(manual.makeManualHistoryRow({kind: 'block', profileHref: '', at: AT}), null)
        assert.equal(manual.makeManualHistoryRow({kind: 'block', profileHref: HREF, at: 0}), null)
    })

    console.log('manual history: all tests ran')
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
