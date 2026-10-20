// Decision 12 (coder-instructions-2026-10-18.md, 18 Oct): each queue row's evidence carries the post's full candidate list, written at
// enqueue. The content side writes it on every evidence record it builds (getSpaceFeedProfilePostAssociations), and the worker's
// evidence merge keeps it (mergeCoordinatorEvidence). Source extraction and a vm run for the content side, as the other content tests do.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const {createCoordinatorProgressRules} = require('../shared/js/swCoordinatorProgressRules')

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

const tests = []
function test(name, fn) {
    tests.push({name, fn})
}

test('the content side writes the post\'s full candidate list on every evidence record of that post', () => {
    const body = extractFunction(readRepoFile('shared/js/content.js'), 'function getSpaceFeedProfilePostAssociations(entries)')
    const context = vm.createContext({
        normalizeQuoraProfileHref: href => `${href || ''}`.replace(/\/+$/, ''),
        makeSpaceFeedCandidateEvidence: (collector, confidence) => ({collector, confidence}),
        SPACE_FEED_CANDIDATE_CONFIDENCE_HIGH: 'high',
        location: {href: 'https://www.quora.com/feed'},
        result: null
    })
    vm.runInContext(`${body}\nresult = getSpaceFeedProfilePostAssociations(${JSON.stringify([
        {
            postKey: 'post-1',
            postUrl: 'https://www.quora.com/post/1',
            candidateUrls: ['https://www.quora.com/profile/A-1', 'https://www.quora.com/profile/B-2/', 'https://www.quora.com/profile/A-1']
        },
        {
            postKey: 'post-2',
            postUrl: 'https://www.quora.com/post/2',
            candidateUrls: ['https://www.quora.com/profile/C-3']
        }
    ])})`, context)
    const associations = JSON.parse(JSON.stringify(context.result))
    const byProfile = Object.fromEntries(associations.map(association => [association.profileHref, association]))

    // The list is normalized and de-duplicated, and the same list is on each profile's evidence for that post.
    const postOneList = ['https://www.quora.com/profile/A-1', 'https://www.quora.com/profile/B-2']
    assert.deepEqual(byProfile['https://www.quora.com/profile/A-1'].evidence[0].candidateUrls, postOneList)
    assert.deepEqual(byProfile['https://www.quora.com/profile/B-2'].evidence[0].candidateUrls, postOneList)
    assert.deepEqual(byProfile['https://www.quora.com/profile/C-3'].evidence[0].candidateUrls, ['https://www.quora.com/profile/C-3'])
})

test('the worker evidence merge keeps the candidate list, unions it for duplicates, and leaves records without one unchanged', () => {
    const rules = createCoordinatorProgressRules({})
    const merged = rules.mergeCoordinatorEvidence(
        [{postKey: 'p', postUrl: 'u', collector: 'c', candidateUrls: ['a']}],
        [{postKey: 'p', postUrl: 'u', collector: 'c', candidateUrls: ['b', 'a']}, {postKey: 'q', postUrl: 'v', collector: 'c'}]
    )
    assert.equal(merged.length, 2)
    assert.deepEqual(merged[0].candidateUrls, ['a', 'b'])
    assert.equal(Object.prototype.hasOwnProperty.call(merged[1], 'candidateUrls'), false, 'a record with no list keeps its old shape')
})

let failed = 0
;(async () => {
    for(const {name, fn} of tests) {
        try {
            await fn()
            console.log(`ok - ${name}`)
        }
        catch (error) {
            failed += 1
            console.log(`not ok - ${name}`)
            console.log(error?.stack || error)
        }
    }
    if(failed) {
        console.log(`${failed} candidate list evidence test(s) failed`)
        process.exitCode = 1
    }
})()
