// A close-check reply that rejects a tab for a profile mismatch records the profile the probe expected and the one the tab showed
// (shared/js/swOwnedTabLifecycle.js, 31 Oct). Other replies keep the old fields only, so the recorder does not grow for every probe.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(path.join(__dirname, '..', 'shared', 'js', 'swOwnedTabLifecycle.js'), 'utf8')

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

test('the close-check reply record names the expected and the landed profile on a profile mismatch', () => {
    assert.match(source, /\.\.\.\(response\?\.reason === 'profile-mismatch' \? \{/)
    assert.match(source, /expectedProfileHref: `\$\{message\?\.requestedProfileHref \|\| ''\}`/)
    assert.match(source, /landedProfileHref: `\$\{response\?\.resolvedProfileHref \|\| ''\}`/)
})

test('the mismatch fields are added only inside the close-check record, not on other events', () => {
    const recordStart = source.indexOf("kind: timedOut ? 'close-check-late-reply' : 'close-check-reply'")
    assert.ok(recordStart > 0)
    const recordEnd = source.indexOf('})', recordStart)
    const record = source.slice(recordStart, recordEnd)
    assert.match(record, /expectedProfileHref/)
    assert.equal(source.split('expectedProfileHref').length - 1, 1)
})

console.log('flightRecorderProfileMismatch: all tests passed')
