const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

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

function loadInlineResolutionHarness() {
    const source = readRepoFile('shared/js/content.js')
    const context = {
        normalizeQuoraProfileHref(href = '') {
            if(!href) return null
            if(`${href}`.includes('/profile/')) {
                return `${href}`.startsWith('http') ? `${href}` : `https://www.quora.com${href}`
            }
            return null
        },
        getNormalizedProfileHrefList(urls = []) {
            const seen = new Set()
            const results = []
            for(const href of urls) {
                const normalized = context.normalizeQuoraProfileHref(href)
                if(!normalized || seen.has(normalized)) continue
                seen.add(normalized)
                results.push(normalized)
            }
            return results
        }
    }
    vm.createContext(context)
    vm.runInContext(
        extractFunction(source, 'function getOriginalPosterProfileHrefFromParsedInlinePayload(data = null)'),
        context,
        {filename: 'content-inline-resolution-harness.js'}
    )

    return {
        fromParsedPayload(payload) {
            context.payload = payload
            return vm.runInContext('getOriginalPosterProfileHrefFromParsedInlinePayload(payload)', context)
        }
    }
}

test('inline source-post resolution recovers feed-reason profile targets', () => {
    const source = readRepoFile('shared/js/content.js')
    const harness = loadInlineResolutionHarness()
    const payload = {
        data: {
            question: {
                feedReason: {
                    userNames: [{profileUrl: 'https://www.quora.com/profile/William-Bojanowski'}],
                    userPhotos: [{profileUrl: 'https://www.quora.com/profile/William-Bojanowski'}]
                }
            }
        }
    }

    assert.equal(
        harness.fromParsedPayload(payload),
        'https://www.quora.com/profile/William-Bojanowski'
    )
    assert.match(source, /const patterns = \[[\s\S]*feedReason/)
    assert.equal(source.includes('user(?:Names|Photos)'), true)
})
