// An answer address on a space ("<question title>-answer-<answerer>") chases to the question's log page, the URL a queued resolver row
// carries. So the post is matched to that row while it is queued (owner, 1 Nov). These tests run getSpaceFeedCitedUrl from
// shared/js/content.js against a fake timestamp link.
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
const context = {console, URL, location: {origin: 'https://romancescammercentral.quora.com'}}
vm.createContext(context)
vm.runInContext(extractFunction(source, 'function getSpaceFeedCitedUrl(timestamp)'), context, {filename: 'space-feed-answer-chase-harness.js'})

function citedFor(href) {
    return context.getSpaceFeedCitedUrl({getAttribute: name => (name === 'href' ? href : null)})
}

test('an answer address chases to its question log page', () => {
    assert.equal(
        citedFor('https://romancescammercentral.quora.com/Im-new-here-Are-you-free-to-chat-me-up-answer-Trasha-3'),
        'https://www.quora.com/Im-new-here-Are-you-free-to-chat-me-up/log'
    )
})

test('an answer address with a trailing answerer slug still chases to the question', () => {
    assert.equal(
        citedFor('https://romancescammercentral.quora.com/Are-you-free-answer-Some-Name-42'),
        'https://www.quora.com/Are-you-free/log'
    )
})

test('a post title with no answer segment is not chased', () => {
    assert.equal(citedFor('https://romancescammercentral.quora.com/Just-a-post-title'), '')
})

test('the short-link and unanswered-copy shapes are unchanged', () => {
    assert.equal(citedFor('https://romancescammercentral.quora.com/Title-https-qr-ae-AbC123'), 'https://qr.ae/AbC123')
    assert.equal(
        citedFor('https://romancescammercentral.quora.com/https-www-quora-com-unanswered-Some-Question-ch-17-amp-oid-99'),
        'https://www.quora.com/Some-Question/log'
    )
})
