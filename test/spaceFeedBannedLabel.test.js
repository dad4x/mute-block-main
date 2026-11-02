// A space post's Bad Links button carries the reasons its failed profiles were recorded with (owner, 1 Nov). A banned profile's reason is
// "Profile banned", shown as recorded. These tests run the bad-link detail and the button label from shared/js/content.js against a stub
// for the profile-href normaliser.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

function extractFunction(source, signature) {
    const start = source.indexOf(signature)
    assert.notEqual(start, -1, `missing ${signature}`)
    const braceStart = source.indexOf('{', start + signature.length)
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

async function test(name, fn) {
    try {
        await fn()
        console.log(`ok - ${name}`)
    }
    catch(error) {
        console.error(`not ok - ${name}`)
        throw error
    }
}

const source = readRepoFile('shared/js/content.js')
const context = {console}
vm.createContext(context)
vm.runInContext([
    `function normalizeQuoraProfileHref(href = '') { const v = \`\${href || ''}\`.split(/[?#]/)[0].replace(/\\/+$/, ''); return v.includes('/profile/') ? v : null }`,
    extractFunction(source, 'function getSpaceFeedBadLinkDetail(href, record = null)'),
    extractFunction(source, 'function getSpaceFeedBadLinksButtonLabel(details = [])')
].join('\n\n'), context, {filename: 'space-feed-banned-label-harness.js'})

const ALICE = 'https://www.quora.com/profile/Alice-Example'

test('the detail carries the recorded banned reason', () => {
    const detail = context.getSpaceFeedBadLinkDetail(ALICE, {status: 'profile-unavailable', unavailableReason: 'Profile banned', blockReason: 'quora-banned'})
    assert.equal(detail.reason, 'Profile banned')
    assert.equal(detail.name, 'Alice-Example')
})

test('the detail carries the recorded deactivated reason as recorded', () => {
    const detail = context.getSpaceFeedBadLinkDetail(ALICE, {status: 'profile-unavailable', unavailableReason: 'Profile deactivated', blockReason: 'quora-deactivated'})
    assert.equal(detail.reason, 'Profile deactivated')
})

test('a profile with no recorded reason reads unavailable', () => {
    assert.equal(context.getSpaceFeedBadLinkDetail(ALICE, {status: 'error'}).reason, 'unavailable')
    assert.equal(context.getSpaceFeedBadLinkDetail(ALICE, null).reason, 'unavailable')
})

test('a redirect keeps its redirected reason', () => {
    const detail = context.getSpaceFeedBadLinkDetail(ALICE, {resolvedProfileHref: 'https://www.quora.com/profile/Carol-Example'})
    assert.equal(detail.reason, 'redirected to Carol-Example')
})

test('the button carries the recorded reason, as recorded', () => {
    assert.equal(context.getSpaceFeedBadLinksButtonLabel([{reason: 'Profile banned'}]), 'Profile banned')
    assert.equal(context.getSpaceFeedBadLinksButtonLabel([{reason: 'Profile unavailable'}]), 'Profile unavailable')
})

test('two or more reasons stack, one line per distinct reason, in the order they first appear', () => {
    assert.equal(context.getSpaceFeedBadLinksButtonLabel([{reason: 'Profile banned'}, {reason: 'unavailable'}]), 'Profile banned\nunavailable')
    assert.equal(context.getSpaceFeedBadLinksButtonLabel([{reason: 'unavailable'}, {reason: 'Profile banned'}, {reason: 'Profile banned'}]), 'unavailable\nProfile banned')
})

test('no failed profiles reads Bad Links', () => {
    assert.equal(context.getSpaceFeedBadLinksButtonLabel([]), 'Bad Links')
    assert.equal(context.getSpaceFeedBadLinksButtonLabel(), 'Bad Links')
})
