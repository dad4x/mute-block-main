// A stored profile target is canonical and is read as it is; a live input is normalized once (shared/js/subject.js storedProfileHref, 1 Nov).
// The repeated "-N-x" cut is not idempotent, so a stored Name-1-2 must not be cut again to Name-1 (review of 1 Nov).
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {normalizeQuoraProfileHref, storedProfileHref} = require('../shared/js/subject')

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

test('a stored canonical href is read as it is', () => {
    assert.equal(storedProfileHref('https://www.quora.com/profile/Name-1-2'), 'https://www.quora.com/profile/Name-1-2')
    assert.equal(storedProfileHref('https://www.quora.com/profile/Nick-Davis-1145'), 'https://www.quora.com/profile/Nick-Davis-1145')
})

test('a raw link is normalized once, the same as normalizeQuoraProfileHref', () => {
    assert.equal(storedProfileHref('https://www.quora.com/Name-1-2-3'), 'https://www.quora.com/profile/Name-1-2')
    assert.equal(storedProfileHref('https://www.quora.com/Nick-Davis-1145-M'), 'https://www.quora.com/profile/Nick-Davis-1145')
})

test('reading a stored target again does not change it', () => {
    const stored = storedProfileHref('https://www.quora.com/Name-1-2-3')
    assert.equal(storedProfileHref(stored), stored)
    assert.equal(storedProfileHref(storedProfileHref(stored)), stored)
})

test('a stored Name-1-2 target does not match a tab on the real Name-1 account', () => {
    const stored = storedProfileHref('https://www.quora.com/Name-1-2-3')
    const tabOnName1 = normalizeQuoraProfileHref('https://www.quora.com/profile/Name-1')
    assert.notEqual(storedProfileHref(stored), tabOnName1)
})

test('a stored Name-1-2 target matches a tab on the same raw Name-1-2-3 account', () => {
    const stored = storedProfileHref('https://www.quora.com/Name-1-2-3')
    const tabOnTarget = normalizeQuoraProfileHref('https://www.quora.com/profile/Name-1-2-3')
    assert.equal(storedProfileHref(stored), tabOnTarget)
})

// The sites that compare stored or message values read them with storedProfileHref, not a second normalization (1 Nov).
test('the owner probe, the mismatch checks and the surface checks read stored hrefs as stored', () => {
    const sw = fs.readFileSync(path.join(__dirname, '..', 'shared', 'js', 'sw.js'), 'utf8')
    assert.match(sw, /const requestedProfileHref = metadata\?\.profileHref\n\s+\? storedProfileHref\(metadata\.profileHref\)/)
    assert.match(sw, /const normalizedProfileHref = storedProfileHref\(metadata\?\.profileHref \|\| ''\)/)
    assert.match(sw, /const resolvedProfileHref = storedProfileHref\(response\?\.resolvedProfileHref \|\| ''\)/)
})

test('the identity of a normalized list is read from the canonical href, not normalized again', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'shared', 'js', 'content.js'), 'utf8')
    assert.match(content, /const identityKey = getQuoraProfileSlugDataFromCanonical\(normalized\)\?\.normalizedSlug \|\| ''/)
})

console.log('storedProfileHref: all tests passed')
