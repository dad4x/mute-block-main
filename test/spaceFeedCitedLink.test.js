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

console.log('spaceFeedCitedLink: all tests passed')
