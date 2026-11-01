// The queue item's resolution subject (shared/js/profileResolutionSubject.js, 30 Oct): only the two known values are kept, anything else is
// an item with no subject, which keeps the old behavior.
const assert = require('node:assert/strict')

const {
    RESOLUTION_SUBJECT_POSTER,
    RESOLUTION_SUBJECT_NAMED_PROFILES,
    normalizeResolutionSubject
} = require('../shared/js/profileResolutionSubject')

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

test('the two subjects are the values the queue carries', () => {
    assert.equal(RESOLUTION_SUBJECT_POSTER, 'poster')
    assert.equal(RESOLUTION_SUBJECT_NAMED_PROFILES, 'named-profiles')
})

test('a known subject is kept, with spaces trimmed', () => {
    assert.equal(normalizeResolutionSubject('poster'), 'poster')
    assert.equal(normalizeResolutionSubject(' named-profiles '), 'named-profiles')
})

test('an unknown or missing subject becomes no subject, so old items keep their behavior', () => {
    assert.equal(normalizeResolutionSubject(''), '')
    assert.equal(normalizeResolutionSubject(undefined), '')
    assert.equal(normalizeResolutionSubject('author'), '')
    assert.equal(normalizeResolutionSubject('Poster'), '')
})


// The subject has to reach the worker tab in the action the queue sends, so the copy is pinned in the queue code (30 Oct).
test('the queue copies the subject into the action the worker tab receives', () => {
    const fs = require('node:fs')
    const path = require('node:path')
    const sw = fs.readFileSync(path.join(__dirname, '..', 'shared', 'js', 'sw.js'), 'utf8')
    assert.match(sw, /resolutionSubject: metadata\.resolutionSubject,/)
    assert.match(sw, /resolutionSubject: item\?\.resolutionSubject \|\| '',/)
    const content = fs.readFileSync(path.join(__dirname, '..', 'shared', 'js', 'content.js'), 'utf8')
    assert.match(content, /normalizeResolutionSubject\(claimedAction\?\.resolutionSubject\)/)
})

console.log('profileResolutionSubject: all tests passed')
