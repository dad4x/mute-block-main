const assert = require('node:assert/strict')
const {
    getLikelyQuoraProfileSlug,
    normalizeQuoraProfileHref,
    sanitizeProfileHrefSlug
} = require('../shared/js/subject')

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

test('canonicalizes explicit profile routes and strips trailing subpaths', () => {
    assert.equal(
        normalizeQuoraProfileHref('https://www.quora.com/profile/Some-User/answers'),
        'https://www.quora.com/profile/Some-User'
    )
})

test('canonicalizes direct profile aliases on primary Quora hosts', () => {
    assert.equal(
        normalizeQuoraProfileHref('https://www.quora.com/Some-User-42'),
        'https://www.quora.com/profile/Some-User-42'
    )
})

test('rejects Quora space subdomain paths as profile aliases', () => {
    assert.equal(
        normalizeQuoraProfileHref('https://instantblock.quora.com/Some-User-42'),
        null
    )
})

test('allows explicit profile paths on Quora subdomains', () => {
    assert.equal(
        normalizeQuoraProfileHref('https://example.quora.com/profile/Some-User-42'),
        'https://www.quora.com/profile/Some-User-42'
    )
})

test('rejects likely question slugs', () => {
    assert.equal(getLikelyQuoraProfileSlug('/What-is-this-question'), '')
    assert.equal(
        normalizeQuoraProfileHref('https://www.quora.com/If-you-love-this-country-Democrats-want-you-dead-Will-you-be-thinking-of-that-when-you-go-to-the-polls-this-November'),
        null
    )
    assert.equal(
        normalizeQuoraProfileHref('https://www.quora.com/IN-the-MONTHS-LEADING-UP-TO-the-JFK-ASSASSINATION-were-there-ANY-OCCURANCES-THAT-MIGHT-HAVE-ENRAGED-HIS-ADVERSARIES-TO-the-POINT-of-WANTING-HIM-ELIMINATED-in-A-BRUTAL-AND-SAVAGE-MANNER-AS-HE-WAS'),
        null
    )
    assert.equal(
        normalizeQuoraProfileHref('https://www.quora.com/Apparently-the-Pentagon-is-considering-handing-over-the-Falkland-Islands-over-to-Argentina-as-punishment-Does-this-not-show-the-might-and-power-of-the-USA-to-anybody-who-dares-to-defy-it'),
        null
    )
})

test('preserves title-case direct profile slugs beginning with The', () => {
    assert.equal(getLikelyQuoraProfileSlug('/The-Studious-Contemplator'), 'The-Studious-Contemplator')
})

test('strips known URL artifact tails from slugs', () => {
    assert.equal(sanitizeProfileHrefSlug('Some-User-42-answers'), 'Some-User-42')
    assert.equal(sanitizeProfileHrefSlug('Some-User-42-His-bio'), 'Some-User-42')
})
