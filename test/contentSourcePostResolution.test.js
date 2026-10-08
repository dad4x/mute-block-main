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

test('space-feed poster extraction excludes timestamps from embedded/quoted sub-posts', () => {
    // 2026-09-27 live incident: Franklin Veaux (a genuine contributor)
    // got queued for mute-block again from a target-space page
    // (isTargetSpacePage() branch), even after the 2026-09-25 fix that
    // stopped asset-space pages from treating an embedded/quoted
    // sub-post's author as a candidate. Root cause: that fix only
    // touched the asset-space branch's own caller; the actual bug was
    // one level down, in getSpaceFeedPosterProfileUrls's own timestamp
    // collection, which both isTargetSpacePage() and asset-space callers
    // share -- it walked every a.post_timestamp under postRoot,
    // including ones that belong to a nested embedded/quoted sub-post,
    // and resolved each one to a "poster." Fixing it there closes the
    // gap for every caller instead of re-patching the target-space
    // branch on top of the existing asset-space patch.
    const source = readRepoFile('shared/js/content.js')
    const posterBody = extractFunction(source, 'function getSpaceFeedPosterProfileUrls(postRoot, timestamp)')

    assert.match(source, /const SPACE_FEED_EMBED_SCOPE_SELECTOR =/)
    assert.match(
        posterBody,
        /const embedAncestor = candidate\.closest\(SPACE_FEED_EMBED_SCOPE_SELECTOR\)[\s\S]*continue/
    )
})

test('space-feed profile-link-card scanner excludes embedded/quoted sub-post authors', () => {
    // 2026-10-08 third recurrence of the same Franklin Veaux class of
    // incident -- the 2026-09-25 fix patched getSpaceFeedPostCandidateProfileUrls's
    // asset-space branch, and the 2026-09-27 fix patched
    // getSpaceFeedPosterProfileUrls's timestamp walk (shared by both the
    // asset- and target-space branches). Neither touched this third, wholly
    // separate path: getSpaceFeedProfileLinkCardEntries (asset-space only),
    // which scans the entire space feed's content root for any visible
    // q-box/puppeteer_test_link-classed profile anchor -- the exact markup
    // Quora also uses for an embedded/quoted answer's author byline -- with
    // no awareness of SPACE_FEED_EMBED_SCOPE_SELECTOR at all. A genuine
    // contributor's answer to an unrelated question got embedded/quoted in
    // a troll-patrol (asset) space's post, his byline rendered as this same
    // card shape, and he was queued for mute-block a third time as a result.
    const source = readRepoFile('shared/js/content.js')
    const cardRootBody = extractFunction(source, 'function getSpaceFeedProfileLinkCardRoot(link)')

    assert.match(
        cardRootBody,
        /if\(root\.closest\(SPACE_FEED_EMBED_SCOPE_SELECTOR\)\) return null/
    )
})

test('space-feed post content scopes exclude embedded/quoted sub-post regions', () => {
    // 2026-10-08: auditing the Franklin Veaux pattern turned up two more
    // consumers of the same gap before either could actually be triggered
    // live -- getSpaceFeedPostCandidateProfileUrls's main dom-profile-link
    // loop and its text-profile-url fallback both iterate whatever scopes
    // this function returns, and neither has any embed-awareness of its
    // own. getSpaceFeedPostContentScopes used to deliberately include
    // embed/quote marker elements (.standalone_featurable,
    // [data-is-quora-embed="true"], [data-type="hyperlink_embed"]) as
    // scopes to search *inside*, so an embedded/quoted sub-post's own
    // author byline link (or its plain-text URL) was indistinguishable
    // from something the actual poster deliberately wrote.
    const source = readRepoFile('shared/js/content.js')
    const scopesBody = extractFunction(source, 'function getSpaceFeedPostContentScopes(postRoot)')

    assert.match(
        scopesBody,
        /if\(scope !== postRoot && scope\.closest\(SPACE_FEED_EMBED_SCOPE_SELECTOR\)\) return/
    )
})
