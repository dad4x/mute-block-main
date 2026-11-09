const assert = require('node:assert/strict')
const {
    getLikelyQuoraProfileSlug,
    isLikelyExplicitProfileTargetHref,
    isLikelyExplicitProfileTargetSlug,
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

test('rejects question slugs that have a number in them (30 Oct)', () => {
    assert.equal(
        normalizeQuoraProfileHref('https://www.quora.com/What-made-the-2707-so-superior'),
        null
    )
    assert.equal(getLikelyQuoraProfileSlug('/What-made-the-2707-so-superior'), '')
})

test('still accepts a profile with a question-word first name and a number (30 Oct)', () => {
    assert.equal(
        normalizeQuoraProfileHref('https://www.quora.com/Will-Fridolf-5'),
        'https://www.quora.com/profile/Will-Fridolf-5'
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

test('keeps URL-looking tails as written until a live example proves they must go (owner, 15 Oct)', () => {
    assert.equal(sanitizeProfileHrefSlug('Some-User-42-answers'), 'Some-User-42-answers')
    assert.equal(sanitizeProfileHrefSlug('Some-User-42-his-bio'), 'Some-User-42-his-bio')
    assert.equal(sanitizeProfileHrefSlug('Quert-5-followers'), 'Quert-5-followers')
    assert.equal(sanitizeProfileHrefSlug('Cesc-Fabregas-share-56'), 'Cesc-Fabregas-share-56')
})

test('case-shifted tokens and other suffixes are kept as written (owner, 14 and 15 Oct)', () => {
    // Cesc-Fabregas-SHARE-56 and Cesc-Fabregas are different profiles, so the upper-case SHARE is kept.
    assert.equal(sanitizeProfileHrefSlug('Cesc-Fabregas-SHARE-56'), 'Cesc-Fabregas-SHARE-56')
    assert.equal(
        normalizeQuoraProfileHref('https://www.quora.com/profile/Cesc-Fabregas-SHARE-56'),
        'https://www.quora.com/profile/Cesc-Fabregas-SHARE-56'
    )
    assert.equal(sanitizeProfileHrefSlug('Cesc-Fabregas-56-SHARE-Bio'), 'Cesc-Fabregas-56-SHARE-Bio')
    assert.equal(sanitizeProfileHrefSlug('Some-User-42-His-Bio'), 'Some-User-42-His-Bio')
    // Suffixes are kept as written, so no tail or lower-case artifact is cut (owner, 15 Oct).
    assert.equal(sanitizeProfileHrefSlug('Some-User-42-His-bio'), 'Some-User-42-His-bio')
    assert.equal(sanitizeProfileHrefSlug('Cesc-Fabregas-56-SHARE-x'), 'Cesc-Fabregas-56-SHARE-x')
    assert.equal(sanitizeProfileHrefSlug('Cesc-Fabregas-56-SHARE-bio'), 'Cesc-Fabregas-56-SHARE-bio')
    assert.equal(sanitizeProfileHrefSlug('Name-12-bio-details'), 'Name-12-bio-details')
    // The query and fragment are still dropped.
    assert.equal(sanitizeProfileHrefSlug('Cesc-Fabregas-56?share=abc#top'), 'Cesc-Fabregas-56')
})

test('a fullwidth lookalike is a different profile, not folded onto the real one (review-4 R4-1)', () => {
    const lookalike = 'Ｃｅｓｃ-Fabregas-56'
    assert.equal(normalizeQuoraProfileHref('https://www.quora.com/profile/Cesc-Fabregas-56'), 'https://www.quora.com/profile/Cesc-Fabregas-56')
    assert.notEqual(
        normalizeQuoraProfileHref(`https://www.quora.com/profile/${lookalike}`),
        normalizeQuoraProfileHref('https://www.quora.com/profile/Cesc-Fabregas-56')
    )
    assert.equal(sanitizeProfileHrefSlug(lookalike), lookalike)
})

test('accents are composed (NFC), so a decomposed spelling is the same profile as the composed one (review-4 R4-1)', () => {
    assert.equal(
        normalizeQuoraProfileHref('https://www.quora.com/profile/Jose%CC%81-Garcia-1'),
        normalizeQuoraProfileHref('https://www.quora.com/profile/Jos%C3%A9-Garcia-1')
    )
})

test('a trailing separator or space is part of the identity, not trimmed (review-4 R4-3)', () => {
    assert.equal(sanitizeProfileHrefSlug('Cesc-Fabregas-56-'), 'Cesc-Fabregas-56-')
    assert.equal(sanitizeProfileHrefSlug('Cesc-Fabregas-56_'), 'Cesc-Fabregas-56_')
    assert.equal(sanitizeProfileHrefSlug('Cesc-Fabregas-56 '), 'Cesc-Fabregas-56 ')
    assert.notEqual(
        normalizeQuoraProfileHref('https://www.quora.com/profile/Cesc-Fabregas-56-'),
        normalizeQuoraProfileHref('https://www.quora.com/profile/Cesc-Fabregas-56')
    )
})

test('rejects prose-contaminated explicit profile target slugs', () => {
    assert.equal(isLikelyExplicitProfileTargetSlug('Darlene-McConnell-61'), true)
    assert.equal(isLikelyExplicitProfileTargetHref('https://www.quora.com/profile/Darlene-McConnell-61'), true)
    assert.equal(
        isLikelyExplicitProfileTargetSlug('Abner-Zefers-freely-states-hes-a-troll-It-saves-so-much-time-checking-t'),
        false
    )
    assert.equal(
        isLikelyExplicitProfileTargetHref('https://www.quora.com/profile/Abner-Zefers-freely-states-hes-a-troll-It-saves-so-much-time-checking-t'),
        false
    )
})

test('a trailing -N-M drops the -M, and a bare trailing -N is kept (owner, 31 Oct)', () => {
    assert.equal(sanitizeProfileHrefSlug('Nick-Davis-1145-M'), 'Nick-Davis-1145')
    assert.equal(sanitizeProfileHrefSlug('Fridoff-2-M'), 'Fridoff-2')
    assert.equal(normalizeQuoraProfileHref('https://www.quora.com/profile/Nick-Davis-1145-M'), 'https://www.quora.com/profile/Nick-Davis-1145')
    assert.equal(sanitizeProfileHrefSlug('Fridoff-1'), 'Fridoff-1')
    assert.equal(sanitizeProfileHrefSlug('Name-12-ab'), 'Name-12-ab')
    assert.equal(sanitizeProfileHrefSlug('Cesc-Fabregas-56-SHARE-x'), 'Cesc-Fabregas-56-SHARE-x')
})

test('a trailing -N-digit drops the digit too (owner, 31 Oct: Will-Fridolf-5-1 is Will-Fridolf-5)', () => {
    assert.equal(sanitizeProfileHrefSlug('Will-Fridolf-5-1'), 'Will-Fridolf-5')
    assert.equal(normalizeQuoraProfileHref('https://www.quora.com/Will-Fridolf-5-1'), 'https://www.quora.com/profile/Will-Fridolf-5')
    assert.equal(sanitizeProfileHrefSlug('Name-1-2-3'), 'Name-1-2')
    assert.equal(sanitizeProfileHrefSlug('Will-Fridolf-5'), 'Will-Fridolf-5')
})
