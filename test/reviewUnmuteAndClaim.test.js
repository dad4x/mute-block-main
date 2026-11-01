// Review of 1 Nov (shared/js/content.js): a claimed target is read as stored; a Pardon completes only when its unmute is ok (queued and manual
// paths); the whole-page unmute confirmation fallback needs a confirmation surface.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(path.join(__dirname, '..', 'shared', 'js', 'content.js'), 'utf8')

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

test('a claimed target is read as stored, not normalized a second time', () => {
    assert.match(source, /let queuedProfileHref = storedProfileHref\(claimedAction\?\.targetUrl \|\| ''\) \|\| normalizeQuoraProfileHref\(location\.href\)/)
    assert.doesNotMatch(source, /let queuedProfileHref = normalizeQuoraProfileHref\(claimedAction\?\.targetUrl/)
})

test('a queued Pardon completes only when its unmute is ok', () => {
    assert.match(source, /if\(unmute && unmute\.ok !== true\) \{\n\s+return \{ok: false, reason: unmute\.reason \|\| 'unmute-failed', unblock, unmute\}/)
    assert.doesNotMatch(source, /if\(unmute\?\.reason === 'unmute-clicked-unverified'\)/)
})

test('a manual Pardon fails when its unmute is not ok, including an option that was not found', () => {
    assert.match(source, /if\(!unmute\.ok\) \{\n\s+return \{ok: false, reason: unmute\.reason \|\| 'unmute-failed', unmute\}/)
    assert.doesNotMatch(source, /unmute\.reason !== 'unmute-option-not-found'/)
})

test('the whole-page unmute confirmation fallback requires a confirmation surface', () => {
    assert.match(source, /getInPageConfirmPairAction\(\/\\bun\[\\s-\]\*mute\\b\|\\bconfirm\\b\|\\bcontinue\\b\/i, \{requireConfirmation: true\}\)/)
    assert.match(source, /function getInPageConfirmPairAction\(preferredRegex, options = \{\}\) \{/)
    assert.match(source, /\(candidate\.hasCancelPeer && \/\\bsure\\b\|\\bconfirm\\b\|\\bare you\\b\|\\\?\/i\.test\(candidate\.contextText\)\)/)
})

// 1 Nov (review nit): with neither the Unmute nor the Mute action readable, the unmute is unverified, not a success.
test('an unreadable unmute menu is an unverified failure, not unmute-option-not-offered success', () => {
    const body = source.slice(source.indexOf('async function unmuteProfileBestEffort('))
    const end = body.indexOf('\n}\n')
    const fn = body.slice(0, end)
    assert.doesNotMatch(fn, /reason: 'unmute-option-not-offered'/)
    assert.match(fn, /return \{ok: false, changed: false, reason: 'unmute-menu-unreadable'\}/)
})

console.log('reviewUnmuteAndClaim: all tests passed')
