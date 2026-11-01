// Queue identity keeps a stored target as stored (review of 1 Nov, P1): a target normalized once from Name-1-2-3 is Name-1-2, and it must
// stay Name-1-2 through the executor item href, the queue lookup and the canonical subject. Name-1 is a different account.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {normalizeQuoraProfileHref} = require('../shared/js/subject')
const {makeCanonicalSubject, makeCanonicalSubjectFromStored} = require('../shared/js/jobState')
const {createCoordinatorExecutorClassification} = require('../shared/js/swCoordinatorExecutorClassification')

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

const classification = createCoordinatorExecutorClassification({
    handlers: {normalizeQuoraProfileUrl: normalizeQuoraProfileHref},
    state: {}
})
const stored = normalizeQuoraProfileHref('https://www.quora.com/Name-1-2-3')
const name1 = normalizeQuoraProfileHref('https://www.quora.com/profile/Name-1')

test('a stored target keeps its identity as the item href', () => {
    assert.equal(stored, 'https://www.quora.com/profile/Name-1-2')
    assert.equal(classification.getCoordinatorItemHref({targetProfileHref: stored}), stored)
})

test('the queue lookup finds the stored target and does not alias it to the Name-1 row', () => {
    const queue = {}
    queue[stored] = {targetProfileHref: stored, status: 'queued'}
    queue[name1] = {targetProfileHref: name1, status: 'queued'}
    assert.equal(classification.findCoordinatorQueueEntryForHref(queue, stored)?.key, stored)
    assert.equal(classification.findCoordinatorQueueEntryForHref(queue, name1)?.key, name1)
})

test('a raw tab URL on the target account still finds its row through one normalization', () => {
    const queue = {}
    queue[stored] = {targetProfileHref: stored, status: 'queued'}
    assert.equal(classification.findCoordinatorQueueEntryForHref(queue, 'https://www.quora.com/profile/Name-1-2-3')?.key, stored)
})

test('the canonical subject of a stored target is the stored href, while raw input keeps its single normalization', () => {
    assert.equal(makeCanonicalSubjectFromStored(stored).href, stored)
    assert.equal(makeCanonicalSubject('https://www.quora.com/Name-1-2-3').href, stored)
    // The double cut is what the stored reader avoids: normalizing the stored target again gives Name-1.
    assert.equal(makeCanonicalSubject(stored).href, name1)
})

test('the envelope and the executor read the stored target through the stored reader', () => {
    const envelope = fs.readFileSync(path.join(__dirname, '..', 'shared', 'js', 'swCoordinatorJobEnvelope.js'), 'utf8')
    assert.match(envelope, /const targetProfileHref = storedProfileHref\(details\.targetProfileHref \|\| ''\)/)
    assert.match(envelope, /\? makeCanonicalSubjectFromStored\(targetProfileHref\)/)
    const classificationSource = fs.readFileSync(path.join(__dirname, '..', 'shared', 'js', 'swCoordinatorExecutorClassification.js'), 'utf8')
    assert.match(classificationSource, /if\(item\?\.targetProfileHref\) return storedProfileHref\(item\.targetProfileHref\)/)
})

console.log('queueIdentityStored: all tests passed')
