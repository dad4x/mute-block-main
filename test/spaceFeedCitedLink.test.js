// The cited short link of a target-space post (content.js getSpaceFeedCitedUrl, 30 Oct). An Instant Block post's address is its title
// and then "-https-qr-ae-<code>", which names the post it cites. The slugs below are the addresses seen on the Instant Block space.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, '..', 'shared', 'js', 'content.js'), 'utf8')

// Pulls one top-level function out of content.js by its header, matching braces (the same approach as the contract tests).
function extractFunction(text, header) {
    const start = text.indexOf(header)
    if (start < 0) throw new Error(`missing ${header}`)
    let depth = 0
    let opened = false
    for (let i = text.indexOf('{', start); i < text.length; i += 1) {
        if (text[i] === '{') { depth += 1; opened = true }
        if (text[i] === '}') { depth -= 1; if (opened && depth === 0) return text.slice(start, i + 1) }
    }
    throw new Error(`unterminated ${header}`)
}

const context = vm.createContext({location: {origin: 'https://instantblock.quora.com'}, URL})
vm.runInContext(extractFunction(source, 'function getSpaceFeedCitedUrl(timestamp) {'), context)
const cited = href => vm.runInContext('getSpaceFeedCitedUrl(timestamp)', Object.assign(context, {
    timestamp: {getAttribute: name => (name === 'href' ? href : null)}
}))

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

test('an Instant Block post that cites a qr.ae link returns that link (the question about the gods)', () => {
    assert.equal(
        cited('https://instantblock.quora.com/Why-do-all-the-gods-ask-me-for-advice-https-qr-ae-pFzTuG?ch=10&oid=258122334'),
        'https://qr.ae/pFzTuG'
    )
})

test('another cited qr.ae link is read the same way (the block-me post)', () => {
    assert.equal(
        cited('https://instantblock.quora.com/Why-did-you-block-me-Obviously-you-cant-handle-the-truth-https-qr-ae-pFzpLs'),
        'https://qr.ae/pFzpLs'
    )
})

test('a post with no cited link returns nothing, so its header stays the candidate', () => {
    assert.equal(cited('https://instantblock.quora.com/Obvious-troll-is-obvious-It-s-the-usual-BF'), '')
    assert.equal(cited(''), '')
})

// A question addressed as its quora.com copy: the chase goes to the question's log page, which names the asker (30 Oct).
test('a question address returns the question log page, with the oid and the share tail dropped', () => {
    assert.equal(
        cited('https://instantblock.quora.com/https-www-quora-com-unanswered-When-I-put-on-a-bra-and-panties-while-doing-meth-how-do-you-feel-ch-17-amp-oid-227768325-amp-share-edfe909e'),
        'https://www.quora.com/When-I-put-on-a-bra-and-panties-while-doing-meth-how-do-you-feel/log'
    )
    assert.equal(
        cited('https://instantblock.quora.com/https-www-quora-com-unanswered-If-you-were-a-Quora-troll-what-are-some-questions-you-would-ask'),
        'https://www.quora.com/If-you-were-a-Quora-troll-what-are-some-questions-you-would-ask/log'
    )
})

test('a qr.ae code that is not at the end of the address is not read as a cited link', () => {
    assert.equal(cited('https://instantblock.quora.com/https-qr-ae-pFzTuG-and-more-words'), '')
})

// The question rows (30 Oct): a question's row is its question component, and its querent is read from the question's own log page with the
// poster subject. The rows are kept out of the post scan, which only reads timestamps.
test('question rows are found by their question component, and resolve the poster from the /log page', () => {
    const rowBody = extractFunction(source, 'function getSpaceFeedQuestionRow(link) {')
    assert.match(rowBody, /puppeteer_test_question_component/)
    const entriesBody = extractFunction(source, 'function getSpaceFeedQuestionRowEntries() {')
    assert.match(entriesBody, /resolutionUrl: `\$\{submissionUrl\}\/log`/)
    assert.match(entriesBody, /resolutionSubject: RESOLUTION_SUBJECT_POSTER/)
})

// The button round trip (31 Oct): a cited post's chase URL and subject are written to the toolbar and row buttons and read back for Nuke or
// Collect. The normalizer used to keep only the post key and URLs, so the chase fell back to the post's own address and never landed.
const normalizeContext = vm.createContext({
    getNormalizedProfileHrefList: list => list,
    isResolvableSpaceFeedEntry: entry => !!(entry?.resolutionUrl || entry?.postUrl)
})
vm.runInContext(extractFunction(source, 'function normalizeSpaceFeedButtonEntries(entries = []) {'), normalizeContext)

test('a cited post keeps its chase URL and poster subject through the button round trip', () => {
    const cited = {
        postKey: 'space-post:https://instantblock.quora.com/Why-did-you-block-me-https-qr-ae-pFzpLs',
        postUrl: 'https://instantblock.quora.com/Why-did-you-block-me-https-qr-ae-pFzpLs',
        candidateUrls: [],
        resolveProfileFromPage: true,
        resolutionReason: 'target-post-cites-source',
        resolutionUrl: 'https://qr.ae/pFzpLs',
        resolutionSubject: 'poster'
    }
    const [kept] = vm.runInContext('normalizeSpaceFeedButtonEntries(entries)', Object.assign(normalizeContext, {
        entries: JSON.parse(JSON.stringify([cited]))
    }))
    assert.equal(kept.resolutionUrl, 'https://qr.ae/pFzpLs')
    assert.equal(kept.resolutionSubject, 'poster')
    assert.equal(kept.postUrl, cited.postUrl)
    assert.equal(kept.resolveProfileFromPage, true)
})

test('an entry with no chase fields keeps them empty', () => {
    const [kept] = vm.runInContext('normalizeSpaceFeedButtonEntries(entries)', Object.assign(normalizeContext, {
        entries: [{postKey: 'space-post:x', postUrl: 'https://instantblock.quora.com/x', candidateUrls: ['https://www.quora.com/profile/A']}]
    }))
    assert.equal(kept.resolutionUrl, '')
    assert.equal(kept.resolutionSubject, '')
})

// The open check (31 Oct): a qr.ae short link redirects, so a tab that lands on a Quora page has committed to the link. The matcher lives in
// swexecutor.js, and its helper is pulled out the same way as the content functions above.
const executorSource = fs.readFileSync(path.join(__dirname, '..', 'shared', 'js', 'swexecutor.js'), 'utf8')
const shortLinkContext = vm.createContext({URL})
vm.runInContext(extractFunction(executorSource, 'function isShortLinkRedirectLanding(expectedUrl = \'\', observedUrl = \'\') {'), shortLinkContext)
const isLanding = (expectedUrl, observedUrl) => vm.runInContext('isShortLinkRedirectLanding(expectedUrl, observedUrl)', Object.assign(shortLinkContext, {expectedUrl, observedUrl}))

test('a tab on a Quora page after a qr.ae link has committed to that link', () => {
    assert.equal(isLanding('https://qr.ae/pFlkPq', 'https://www.quora.com/Are-there-wives-who-have-successfully-feminized-their-husbands?ch=10&oid=214526863'), true)
    assert.equal(isLanding('https://qr.ae/pFlkPq', 'https://theobvioustrollshootinggallery.quora.com/'), true)
})

test('a redirect to a non-Quora page does not count, and other links are not treated as short links', () => {
    assert.equal(isLanding('https://qr.ae/pFlkPq', 'https://example.com/whatever'), false)
    assert.equal(isLanding('https://www.quora.com/profile/Someone', 'https://www.quora.com/Some-question'), false)
    assert.equal(isLanding('https://qr.ae/pFlkPq', ''), false)
})

// The landing (31 Oct): a queued resolution on a question page goes to the question's log in the same tab, and the log page reads the poster.
test('a queued resolution on a question page goes to the question log, and the claim is per tab', () => {
    const body = extractFunction(source, 'async function maybeRunAutoProfileAction() {')
    assert.match(body, /const continueQueuedResolutionToQuestionLog = async \(\) => \{/)
    assert.match(body, /if\(getPageType\(\) !== 'question' \|\| !isQueuedResolutionAction\(\)\) return false/)
    assert.match(body, /location\.replace\(logHref\)/)
    assert.equal((body.match(/if\(await continueQueuedResolutionToQuestionLog\(\)\) return/g) || []).length, 2)
})

// The question card (31 Oct): a post's question card is read from the timestamp's ancestors, and the climb stops at the first ancestor that
// holds another post. A small fake DOM stands in for the page: each node has a parent, children, and the two queries the function makes.
function fakeNode(tag, attrs = {}, children = []) {
    const node = {tagName: tag, attrs, children, parentElement: null}
    for(const child of children) child.parentElement = node
    node.getAttribute = name => (Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null)
    node.matchesTimestamp = !!attrs.timestamp
    const descendantsOf = current => current.children.flatMap(child => [child, ...descendantsOf(child)])
    node.querySelectorAll = selector => {
        const all = descendantsOf(node)
        if(selector.includes('post_timestamp')) return all.filter(n => n.matchesTimestamp)
        if(selector === 'a[href]') return all.filter(n => n.tagName === 'a' && n.attrs.href !== undefined)
        return []
    }
    return node
}
const cardContext = vm.createContext({URL, location: {origin: 'https://instantblock.quora.com'}, document: {body: null}})
const cardRoots = source.slice(source.indexOf('const SPACE_FEED_QUESTION_CARD_NON_QUESTION_ROOTS'), source.indexOf('function getSpaceFeedQuestionCardCitedUrl'))
vm.runInContext('const SPACE_FEED_QUESTION_CARD_MAX_LEVELS = 20\n' + cardRoots + extractFunction(source, 'function getSpaceFeedQuestionCardCitedUrl(timestamp) {'), cardContext)
const cardCited = timestamp => vm.runInContext('getSpaceFeedQuestionCardCitedUrl(timestamp)', Object.assign(cardContext, {timestamp}))

test('a post with a question card is chased to the question log, using the full card address', () => {
    const timestamp = fakeNode('a', {href: 'https://instantblock.quora.com/Unhindered-https-www-quora-com-unanswered-Are-there-some-t', timestamp: true})
    const card = fakeNode('a', {href: 'https://www.quora.com/unanswered/Are-there-some-Americans-US-state-nationals-that-are-aware-that-the-United-States/'})
    const post = fakeNode('div', {}, [fakeNode('div', {}, [timestamp]), fakeNode('div', {}, [card])])
    const feed = fakeNode('div', {}, [post])
    fakeNode('div', {}, [feed])
    assert.equal(cardCited(timestamp), 'https://www.quora.com/unanswered/Are-there-some-Americans-US-state-nationals-that-are-aware-that-the-United-States/log')
})

test('the climb stops at the next post, so another post\'s card is not taken', () => {
    const timestampA = fakeNode('a', {href: 'https://instantblock.quora.com/A', timestamp: true})
    const timestampB = fakeNode('a', {href: 'https://instantblock.quora.com/B', timestamp: true})
    const cardB = fakeNode('a', {href: 'https://www.quora.com/unanswered/Belongs-to-B'})
    const postA = fakeNode('div', {}, [timestampA])
    const postB = fakeNode('div', {}, [timestampB, cardB])
    fakeNode('div', {}, [postA, postB])
    assert.equal(cardCited(timestampA), '')
    assert.equal(cardCited(timestampB), 'https://www.quora.com/unanswered/Belongs-to-B/log')
})

test('profile links and non-question links in a card are not chased', () => {
    const timestamp = fakeNode('a', {href: 'https://instantblock.quora.com/Post', timestamp: true})
    const profile = fakeNode('a', {href: 'https://www.quora.com/profile/Nate-Waddoups'})
    const topic = fakeNode('a', {href: 'https://www.quora.com/topic/Politics'})
    const post = fakeNode('div', {}, [timestamp, profile, topic])
    fakeNode('div', {}, [post])
    assert.equal(cardCited(timestamp), '')
})

// A root-level question card (31 Oct): an answered question's card links to "www.quora.com/<question>", with the question as its text.
// Profile aliases use the same root form, but their link text is a name with no question mark, so they are not chased.
function fakeCard(href, text) {
    const link = fakeNode('a', {href})
    link.textContent = text
    return link
}
test('a root-level question card is chased to its log, and a profile alias on the same form is not', () => {
    const timestamp = fakeNode('a', {href: 'https://instantblock.quora.com/Another-rude-https-www-quora-com-Am-I-the-only-one', timestamp: true})
    timestamp.textContent = '11h'
    const card = fakeCard('https://www.quora.com/Am-I-the-only-one-here-to-think-that-Patrick-Stewart-was-a-terrible-actor', 'Am I the only one here to think that Patrick Stewart was a terrible actor?')
    const post = fakeNode('div', {}, [fakeNode('div', {}, [timestamp]), fakeNode('div', {}, [card])])
    fakeNode('div', {}, [post])
    assert.equal(cardCited(timestamp), 'https://www.quora.com/Am-I-the-only-one-here-to-think-that-Patrick-Stewart-was-a-terrible-actor/log')

    const profileTimestamp = fakeNode('a', {href: 'https://instantblock.quora.com/Post', timestamp: true})
    profileTimestamp.textContent = '2h'
    const alias = fakeCard('https://www.quora.com/Some-User-42', 'Some User')
    const aliasPost = fakeNode('div', {}, [profileTimestamp, alias])
    fakeNode('div', {}, [aliasPost])
    assert.equal(cardCited(profileTimestamp), '')
})

test('a root-level link to a non-question root (topic, space) is not chased even with a question mark in its text', () => {
    const timestamp = fakeNode('a', {href: 'https://instantblock.quora.com/Post2', timestamp: true})
    timestamp.textContent = '1h'
    const topic = fakeCard('https://www.quora.com/topic/Politics', 'What is politics?')
    const post = fakeNode('div', {}, [timestamp, topic])
    fakeNode('div', {}, [post])
    assert.equal(cardCited(timestamp), '')
})

console.log('spaceFeedCitedLink: all tests passed')
