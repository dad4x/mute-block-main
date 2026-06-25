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

test('source-author-only asset posts are not resolver rows', () => {
    const source = readRepoFile('shared/js/content.js')
    const entriesBody = extractFunction(source, 'function getSpaceFeedPostEntries()')
    const queueableResolverBody = extractFunction(source, 'function isQueueableSpaceFeedResolverEntry(entry)')
    const queueableResolverRenderBody = extractFunction(source, 'function isQueueableSpaceFeedResolverEntryForRender(entry = null, context = null)')

    assert.match(entriesBody, /resolveProfileFromPage: isAssetSpacePage\(\) && !!postUrl && needsSourceResolution/)
    assert.doesNotMatch(entriesBody, /!candidateUrls\.length \|\| needsSourceResolution/)
    assert.match(queueableResolverBody, /resolutionReason \|\| ''\}`\.trim\(\) === 'low-confidence-profile-artifact'[\s\S]*return false/)
    assert.match(queueableResolverRenderBody, /resolutionReason \|\| ''\}`\.trim\(\) === 'low-confidence-profile-artifact'[\s\S]*return false/)
})

test('source-post resolver admission waits for complete direct-candidate collection', () => {
    const source = readRepoFile('shared/js/content.js')
    const candidateBody = extractFunction(source, 'function getSpaceFeedPostCandidateProfileUrls(postRoot, timestamp)')
    const entriesBody = extractFunction(source, 'function getSpaceFeedPostEntries()')
    const queueableResolverBody = extractFunction(source, 'function isQueueableSpaceFeedResolverEntry(entry)')
    const queueableResolverRenderBody = extractFunction(source, 'function isQueueableSpaceFeedResolverEntryForRender(entry = null, context = null)')
    const associationBody = extractFunction(source, 'function getResolvableSpaceFeedPostAssociations(entries)')

    assert.match(candidateBody, /if\(!urls\.length && isAssetSpacePage\(\)\) \{[\s\S]*needsSourceResolution = true[\s\S]*continue[\s\S]*\}/)
    assert.match(candidateBody, /return attachSpaceFeedCandidateMetadata\(urls, candidateEvidenceByHref, needsSourceResolution\)/)
    assert.match(entriesBody, /needsSourceResolution = candidateUrls\.needsSourceResolution === true/)
    assert.match(entriesBody, /while\(!candidateUrls\.length && node && node !== contentRoot\)/)
    assert.doesNotMatch(entriesBody, /while\(!candidateUrls\.length && !needsSourceResolution && node && node !== contentRoot\)/)
    assert.match(entriesBody, /resolutionReason: needsSourceResolution \? 'low-confidence-profile-artifact' : ''/)
    assert.match(entriesBody, /resolveProfileFromPage: isAssetSpacePage\(\) && !!postUrl && needsSourceResolution/)
    assert.match(queueableResolverBody, /getQueueableSpaceFeedEntryUrls\(entry\)\.length >= SPACE_FEED_POST_NUKE_MIN_PROFILES[\s\S]*return false/)
    assert.match(queueableResolverRenderBody, /getQueueableSpaceFeedEntryUrlsForRender\(entry, context\)\.length >= SPACE_FEED_POST_NUKE_MIN_PROFILES[\s\S]*return false/)
    assert.match(associationBody, /source-post-resolution/)
})
