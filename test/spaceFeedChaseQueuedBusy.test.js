// A space post whose resolver chase is already queued is busy, so it keeps its Nuking pill (owner, 1 Nov). Once the chase is queued the
// resolver is no longer queueable, so without this rule the post had no controls at all. These tests run buildSpaceFeedRenderEntry and the
// chase check from shared/js/content.js with the queue facts stubbed.
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
const CHASE = 'https://www.quora.com/Im-new-here-Are-you-free-to-chat-me-up/log'
const POST = 'https://romancescammercentral.quora.com/Im-new-here-Are-you-free-to-chat-me-up-answer-Trasha-3'

function loadHarness(queuedChases = []) {
    const context = {console, queuedChases: new Set(queuedChases)}
    vm.createContext(context)
    vm.runInContext([
        'const SPACE_FEED_POST_NUKE_MIN_PROFILES = 1',
        `function normalizeQuoraPostHref(href = '') { return href || null }`,
        `function normalizeQuoraQuestionHref(value = '') { return null }`,
        `function getNormalizedProfileHrefList(urls = []) { return Array.isArray(urls) ? [...new Set(urls)] : [] }`,
        `function isSpaceFeedEntryNukedForRender() { return false }`,
        `function getActivePendingSpaceFeedUrlsForRender() { return [] }`,
        `function getQueueableSpaceFeedEntryUrlsForRender() { return [] }`,
        // A resolver whose chase is queued is not queueable (see isQueueableSpaceFeedResolverEntryForRender), so the stub says so.
        `function isQueueableSpaceFeedResolverEntryForRender(entry) { return !isSpaceFeedResolverChaseQueued(entry) && !!entry?.resolveProfileFromPage }`,
        `function getPendingSpaceFeedIndex() { return {resolverPostKeys: new Set(), resolverChaseUrls: queuedChases, hrefsByPostKey: new Map()} }`,
        `function isSpaceFeedPostNuking() { return false }`,
        `function isSpaceFeedPostPendingForRender() { return false }`,
        extractFunction(source, 'function isResolvableSpaceFeedEntry(entry)'),
        extractFunction(source, "function normalizeSpaceFeedChaseUrl(url = '')"),
        extractFunction(source, 'function isSpaceFeedResolverChaseQueued(entry = null)'),
        extractFunction(source, 'function buildSpaceFeedRenderEntry(entry = null, context = null)')
    ].join('\n\n'), context, {filename: 'space-feed-chase-queued-busy-harness.js'})
    return context
}

function resolverEntry(extra = {}) {
    return {postKey: `space-post:${POST}`, postUrl: POST, candidateUrls: [], resolveProfileFromPage: true, resolutionUrl: CHASE, resolutionReason: 'target-post-cites-source', ...extra}
}

test('a post whose resolver chase is queued is busy, with no Mute Block offered', () => {
    const context = loadHarness([CHASE])
    const entry = context.buildSpaceFeedRenderEntry(resolverEntry(), null)
    assert.equal(entry.postBusy, true)
    assert.equal(entry.hasResolver, false)
    assert.equal(entry.hasCandidates, false)
})

test('a post whose resolver chase is not queued is not busy, and its resolver is offered', () => {
    const context = loadHarness([])
    const entry = context.buildSpaceFeedRenderEntry(resolverEntry(), null)
    assert.equal(entry.postBusy, false)
    assert.equal(entry.hasResolver, true)
})

test('a queued chase for another question does not make this post busy', () => {
    const context = loadHarness(['https://www.quora.com/Some-other-question/log'])
    const entry = context.buildSpaceFeedRenderEntry(resolverEntry(), null)
    assert.equal(entry.postBusy, false)
})

test('a post with no resolvable address is not busy from the chase rule', () => {
    const context = loadHarness([CHASE])
    const entry = context.buildSpaceFeedRenderEntry(resolverEntry({resolveProfileFromPage: false, resolutionUrl: '', postUrl: ''}), null)
    assert.equal(entry.postBusy, false)
})
