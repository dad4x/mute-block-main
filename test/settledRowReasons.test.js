// A profile settled from a finished queue row passes that row's own outcome and error up as the reason. archived-terminal is only the
// status, and the fallback when the row gave neither (3 Nov). These tests read the two settlement sites in shared/js/sw.js.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

async function test(name, fn) {
    try {
        await fn()
        console.log(`ok - ${name}`)
    }
    catch (error) {
        console.error(`not ok - ${name}`)
        console.error(error)
        process.exitCode = 1
    }
}

const sw = readRepoFile('shared/js/sw.js')

test('the live-row settlement passes the row outcome and error as the reason', () => {
    const start = sw.indexOf("status: 'archived-terminal',\n                    blockSucceeded: false,")
    assert.notEqual(start, -1, 'missing the live-row archived-terminal settlement')
    const block = sw.slice(start, start + 500)
    assert.match(block, /unavailableReason: `\$\{liveItem\.outcome \|\| ''\}`\.trim\(\)/)
    assert.match(block, /finalError: `\$\{liveItem\.error \|\| ''\}`\.trim\(\)/)
})

test('the archived-row settlement passes the row outcome and error as the reason', () => {
    const start = sw.indexOf("status: 'archived-terminal',\n                blockSucceeded: false,")
    assert.notEqual(start, -1, 'missing the archived-row archived-terminal settlement')
    const block = sw.slice(start, start + 400)
    assert.match(block, /unavailableReason: outcome,/)
    assert.match(block, /finalError: `\$\{archived\.error \|\| ''\}`\.trim\(\)/)
})

test('the bad-link reason reads unavailableReason before finalError, so the row reason shows', () => {
    const content = readRepoFile('shared/js/content.js')
    // A banned, deactivated, inactivated or deleted signal comes first (6 Nov); otherwise the fallback order below holds.
    assert.match(content, /: signal \? signal\[1\] : \(redirected \? `redirected to \$\{landedHref\.split\('\/profile\/'\)\[1\] \|\| landedHref\}` : \(record\?\.unavailableReason \|\| record\?\.finalError \|\| record\?\.status \|\| 'unavailable'\)\)/)
})
