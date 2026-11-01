// The Nuke 'Em count (31 Oct): a resolver post whose chase URL is already a queued row is not queueable, and the pending index keeps those
// chase URLs. The functions are read out of content.js and run with a stubbed queue.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, '..', 'shared', 'js', 'content.js'), 'utf8')

// Pulls one top-level function out of content.js by its header, matching braces from the body's opening brace.
function extractFunction(text, header) {
    const start = text.indexOf(header)
    if (start < 0) throw new Error(`missing ${header}`)
    let depth = 0
    let opened = false
    for (let i = text.indexOf(') {', start) + 2; i < text.length; i += 1) {
        if (text[i] === '{') { depth += 1; opened = true }
        if (text[i] === '}') { depth -= 1; if (opened && depth === 0) return text.slice(start, i + 1) }
    }
    throw new Error(`unterminated ${header}`)
}

const context = vm.createContext({
    coordinatorQueue: {},
    pendingSpaceFeedIndexCache: {queue: null, index: null},
    spaceFeedEnqueueMarks: {batches: () => []},
    isPendingCoordinatorStatus: status => ['queued', 'opening', 'active', 'acting', 'settling'].includes(status),
    getCoordinatorItemProfileHref: (key, item) => (item && item.targetProfileHref) || ''
})
vm.runInContext(extractFunction(source, 'function getPendingSpaceFeedIndex() {'), context)
vm.runInContext(extractFunction(source, 'function isSpaceFeedResolverChaseQueued(entry = null) {'), context)

function test(name, fn) {
    try {
        fn()
        console.log(`ok - ${name}`)
    }
    catch (error) {
        console.error(`not ok - ${name}`)
        throw error
    }
}

test('a queued resolver row keeps its chase URL, and a profile row does not add one', () => {
    context.coordinatorQueue = {
        'resolve-profile:https://qr.ae/pFqZoE': {status: 'queued', requestedUrl: 'https://qr.ae/pFqZoE', evidence: []},
        'https://www.quora.com/profile/Someone': {status: 'queued', targetProfileHref: 'https://www.quora.com/profile/Someone'}
    }
    context.pendingSpaceFeedIndexCache = {queue: null, index: null}
    const queued = vm.runInContext('isSpaceFeedResolverChaseQueued(entry)', Object.assign(context, {entry: {resolutionUrl: 'https://qr.ae/pFqZoE'}}))
    const other = vm.runInContext('isSpaceFeedResolverChaseQueued(entry)', Object.assign(context, {entry: {resolutionUrl: 'https://qr.ae/pFqejz'}}))
    const profile = vm.runInContext('isSpaceFeedResolverChaseQueued(entry)', Object.assign(context, {entry: {resolutionUrl: 'https://www.quora.com/profile/Someone'}}))
    assert.equal(queued, true)
    assert.equal(other, false)
    assert.equal(profile, false)
})

test('a resolver entry with no chase URL is never counted as queued by it', () => {
    const none = vm.runInContext('isSpaceFeedResolverChaseQueued(entry)', Object.assign(context, {entry: {resolutionUrl: ''}}))
    assert.equal(none, false)
})

test('the render check and the live count use the chase rule', () => {
    assert.match(source, /if\(isSpaceFeedResolverChaseQueued\(entry\)\) return false/)
    assert.match(source, /\(getPendingSpaceFeedIndex\(\)\.resolverPostKeys\.has\(entry\?\.postKey\) \|\| isSpaceFeedResolverChaseQueued\(entry\)\)/)
})

console.log('spaceFeedResolverChaseQueued: all tests passed')
