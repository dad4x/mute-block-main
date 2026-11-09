// A space post whose only candidate profile is already in the queue is busy: it shows Nuking, not Mute Block or Nuke 'Em N. The render entry
// is built from shared/js/content.js; these tests run those functions in a vm context with the queue facts stubbed.
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

const ALICE = 'https://www.quora.com/profile/Alice-Example'
const BOB = 'https://www.quora.com/profile/Bob-Example'
const POST = 'space-post:https://romancescammercentral.quora.com/alice-post'

const source = readRepoFile('shared/js/content.js')

function loadHarness() {
    const context = {console}
    vm.createContext(context)
    vm.runInContext([
        `const SPACE_FEED_POST_NUKE_MIN_PROFILES = 1`,
        `const UNBLOCK_UNMUTE_ACTION_KIND = 'unblock-unmute'`,
        `const TRANSIENT_PROGRESS_STATUSES = new Set(['queued', 'opening', 'active', 'acting', 'settling'])`,
        source.split('\n').find(line => line.startsWith('const PENDING_COORDINATOR_STATUSES')),
        `let pendingSpaceFeedIndexCache = {queue: null, index: null}`,
        `let coordinatorQueue = {}`,
        `let profileNukeProgress = {}`,
        `const spaceFeedNukingPostKeys = new Set()`,
        `const spaceFeedKnownNukedProfileKeys = new Set()`,
        `const spaceFeedAnsweredProfileKeys = new Set()`,
        `const spaceFeedEnqueueMarks = {batches: () => []}`,
        `function isTransientProfileNukeStatus(status) { return TRANSIENT_PROGRESS_STATUSES.has(\`\${status || ''}\`.trim()) }`,
        `function normalizeQuoraProfileHref(href = '') { const v = \`\${href || ''}\`.split(/[?#]/)[0].replace(/\\/+$/, ''); return v.includes('/profile/') ? v : null }`,
        `function normalizeQuoraPostHref(href = '') { return href || null }`,
        `function getNormalizedProfileIdentityKey(href) { return \`\${href || ''}\`.split('/profile/')[1] || '' }`,
        `function getNormalizedProfileHrefList(urls = []) {
            const seen = new Set(); const out = []
            for(const url of Array.isArray(urls) ? urls : []) {
                const n = normalizeQuoraProfileHref(url); const k = getNormalizedProfileIdentityKey(n)
                if(!n || !k || seen.has(k)) continue
                seen.add(k); out.push(n)
            }
            return out
        }`,
        `function isProfileNukeSucceeded(href) { return profileNukeProgress[normalizeQuoraProfileHref(href)]?.status === 'blocked' }`,
        `function isProfileNukeRetryBlocked() { return false }`,
        extractFunction(source, 'function getSpaceFeedProfileStateKey(href)'),
        extractFunction(source, 'function isKnownNukedSpaceFeedProfile(href)'),
        extractFunction(source, 'function isSpaceFeedProfileStateReady(href)'),
        extractFunction(source, 'function isSpaceFeedPostNuked(candidateUrls = null)'),
        extractFunction(source, 'function isPendingCoordinatorStatus(status = \'\')'),
        extractFunction(source, 'function getCoordinatorItemProfileHref(itemKey = \'\', item = null)'),
        extractFunction(source, 'function getPendingSpaceFeedIndex()'),
        extractFunction(source, 'function hasPendingCoordinatorSpaceFeedPost(postKey = \'\')'),
        extractFunction(source, 'function isActivePendingSpaceFeedProfileUrl(url)'),
        extractFunction(source, 'function getActivePendingSpaceFeedUrls(postKey)'),
        extractFunction(source, 'function isSuccessfulProfileNukeRecord(record)'),
        extractFunction(source, 'function isSettledProfileNukeRecord(record)'),
        extractFunction(source, 'function getProfileNukeProgressRecord(href)'),
        extractFunction(source, 'function isSpaceFeedPostNuking(postKey)'),
        extractFunction(source, 'function isSpaceFeedPostPendingForRender(postKey = \'\', context = null)'),
        extractFunction(source, 'function getActivePendingSpaceFeedUrlsForRender(postKey = \'\', context = null)'),
        extractFunction(source, 'function getQueueableSpaceFeedEntryUrlsForRender(entry = null, context = null)'),
        extractFunction(source, 'function isSpaceFeedEntryNukedForRender(entry = null, context = null)'),
        extractFunction(source, 'function isResolvableSpaceFeedEntry(entry)'),
        extractFunction(source, 'function isQueueableSpaceFeedResolverEntryForRender(entry = null, context = null)'),
        extractFunction(source, 'function buildSpaceFeedRenderEntry(entry = null, context = null)'),
        `globalThis.harness = {
            setQueue(queue) { coordinatorQueue = queue; pendingSpaceFeedIndexCache = {queue: null, index: null} },
            ready(urls) { for(const url of urls) spaceFeedAnsweredProfileKeys.add(getSpaceFeedProfileStateKey(url)) },
            build(entry) {
                const index = getPendingSpaceFeedIndex()
                return buildSpaceFeedRenderEntry(entry, {
                    pendingCoordinatorPostKeys: new Set([...index.hrefsByPostKey.keys(), ...index.resolverPostKeys]),
                    pendingCoordinatorProfileHrefs: new Set(Object.values(coordinatorQueue).filter(item => isPendingCoordinatorStatus(item.status)).map(item => getCoordinatorItemProfileHref('', item)).filter(Boolean)),
                    pendingSpaceProfileHrefs: new Set(),
                    activePendingUrls: new Map()
                })
            }
        }`
    ].join('\n\n'), context, {filename: 'space-feed-queued-candidate-busy-harness.js'})
    return context.harness
}

test('a post whose only candidate is queued is busy, not Mute Block', () => {
    const harness = loadHarness()
    harness.ready([ALICE])
    // The queue row names the profile but carries no post key for this post, as a row from another path can.
    harness.setQueue({'item-1': {status: 'queued', targetProfileHref: ALICE, evidence: [{postKey: 'space-post:https://elsewhere.example/x'}]}})

    const entry = harness.build({postKey: POST, candidateUrls: [ALICE], resolveProfileFromPage: false})
    assert.equal(entry.postBusy, true)
    assert.equal(entry.hasCandidates, false)
    assert.equal(entry.queueableUrls.length, 0)
})

test('a post with a queued candidate and another queueable candidate stays a Mute Block post', () => {
    const harness = loadHarness()
    harness.ready([ALICE, BOB])
    harness.setQueue({'item-1': {status: 'queued', targetProfileHref: ALICE, evidence: [{postKey: POST}]}})

    const entry = harness.build({postKey: POST, candidateUrls: [ALICE, BOB], resolveProfileFromPage: false})
    assert.equal(entry.hasCandidates, true)
    assert.equal(JSON.stringify(entry.queueableUrls), JSON.stringify([BOB]))
})

test('a post with no queued candidate is not busy', () => {
    const harness = loadHarness()
    harness.ready([ALICE])
    harness.setQueue({})

    const entry = harness.build({postKey: POST, candidateUrls: [ALICE], resolveProfileFromPage: false})
    assert.equal(entry.postBusy, false)
    assert.equal(entry.hasCandidates, true)
})

test('a candidate whose queue row has finished is not busy', () => {
    const harness = loadHarness()
    harness.ready([ALICE])
    harness.setQueue({'item-1': {status: 'succeeded', targetProfileHref: ALICE, evidence: [{postKey: POST}]}})

    const entry = harness.build({postKey: POST, candidateUrls: [ALICE], resolveProfileFromPage: false})
    assert.equal(entry.postBusy, false)
})
