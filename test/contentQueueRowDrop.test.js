const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

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

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

function extractFunction(source, signature) {
    const start = source.indexOf(signature)
    assert.notEqual(start, -1, `missing ${signature}`)

    const braceStart = source.indexOf('{', start + signature.length)
    assert.notEqual(braceStart, -1, `missing body for ${signature}`)

    let depth = 0
    for(let index = braceStart; index < source.length; index += 1) {
        if(source[index] === '{') depth += 1
        else if(source[index] === '}') {
            depth -= 1
            if(depth === 0) return source.slice(start, index + 1)
        }
    }

    throw new Error(`unterminated ${signature}`)
}

// The two helpers, run on their own: the href normaliser is stubbed to the identity, which is all these rows need.
const source = readRepoFile('shared/js/content.js')
const dropSource = extractFunction(source, 'function dropCoordinatorQueueRowsForProfiles(queue = {}, profileHrefs = [])')
const itemHrefSource = extractFunction(source, 'function getCoordinatorItemProfileHref(itemKey = \'\', item = null)')
const {dropCoordinatorQueueRowsForProfiles} = new Function('normalizeQuoraProfileHref', `${itemHrefSource}\n${dropSource}\nreturn {dropCoordinatorQueueRowsForProfiles}`)(href => `${href || ''}`.trim())

const hrefA = 'https://www.quora.com/profile/Drop-A'
const hrefB = 'https://www.quora.com/profile/Drop-B'
const hrefC = 'https://www.quora.com/profile/Drop-C'

test('a reply drops this page\'s rows for the profiles asked about, and keeps the rows of other profiles', () => {
    const queue = {
        [hrefA]: {targetProfileHref: hrefA, status: 'queued'},
        [hrefB]: {targetProfileHref: hrefB, status: 'active'},
        [hrefC]: {targetProfileHref: hrefC, status: 'queued'}
    }
    const kept = dropCoordinatorQueueRowsForProfiles(queue, [hrefA, hrefB])
    assert.deepEqual(Object.keys(kept), [hrefC], 'only the row of a profile not asked about remains')
})

test('a row keyed by its item key is dropped by the profile href it carries', () => {
    const queue = {'item-key-1': {targetProfileHref: hrefA, status: 'queued'}}
    assert.deepEqual(dropCoordinatorQueueRowsForProfiles(queue, [hrefA]), {})
})

test('with no profiles asked about, the copy is kept whole', () => {
    const queue = {[hrefA]: {targetProfileHref: hrefA, status: 'queued'}}
    assert.deepEqual(dropCoordinatorQueueRowsForProfiles(queue, []), queue)
    assert.notEqual(dropCoordinatorQueueRowsForProfiles(queue, []), queue, 'a new object is returned')
})

test('the space poll keeps asking while this page\'s queue copy holds a pending row, so a finished profile is dropped after the run', () => {
    const pollSource = extractFunction(source, 'async function pollSpaceFeedState()')
    assert.match(pollSource, /hasPendingCoordinatorCopy = Object\.values\(coordinatorQueue \|\| \{\}\)\.some\(item => isPendingCoordinatorStatus\(item\?\.status\)\)/)
    assert.match(pollSource, /&& !hasPendingCoordinatorCopy\) return/)
})

test('the space poll also reconciles the pending posts copy, which only the reconcile replaces from the worker', () => {
    const pollSource = extractFunction(source, 'async function pollSpaceFeedState()')
    assert.match(pollSource, /void reconcileStaleSpaceFeedProgress\(\)/)
})
