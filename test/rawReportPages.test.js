const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const {
    EXPECTED_CAPTURE_FILES,
    RAW_REPORT_PAGES_DIR,
    SPACE_FEED_MARKERS,
    listRawReportPageFiles,
    summarizeRawReportPages
} = require('./lib/rawReportPages')

const repoRoot = path.join(__dirname, '..')
const expectedMinimumProfileCounts = {
    'Anti Spam and Scam.html': 20,
    'Instant Block.html': 80,
    'Spam detectives.html': 180,
    'Taking out the Trash.html': 100,
    'The Obvious Troll shooting gallery.html': 120,
    'The Original Whack-A-Troll\u2122.html': 30,
    'The Q defense crew...html': 100,
    'Troll \uD83E\uDDCC Patrol.html': 30,
    'Trolls galore.html': 120,
    'Umm, no.html': 20
}

const knownProfileSamples = {
    'Anti Spam and Scam.html': 'https://www.quora.com/profile/Elinor-Greenberg',
    'Instant Block.html': 'https://www.quora.com/profile/Hugh-Caley',
    'Spam detectives.html': 'https://www.quora.com/profile/David-Brower',
    'Taking out the Trash.html': 'https://www.quora.com/profile/Brett-W-90',
    'The Obvious Troll shooting gallery.html': 'https://www.quora.com/profile/Pamela-1775',
    'The Original Whack-A-Troll\u2122.html': 'https://www.quora.com/profile/John-Monteith-8',
    'The Q defense crew...html': 'https://www.quora.com/profile/Alex-Johnston-39',
    'Troll \uD83E\uDDCC Patrol.html': 'https://www.quora.com/profile/Crystal-Gillis',
    'Trolls galore.html': 'https://www.quora.com/profile/Dave-Haynie',
    'Umm, no.html': 'https://www.quora.com/profile/Bonnie-Whyte'
}

const tests = []

function test(name, fn) {
    tests.push({name, fn})
}

test('raw report page captures live under test fixtures', () => {
    assert.equal(path.relative(repoRoot, RAW_REPORT_PAGES_DIR), 'test/fixtures/raw-report-pages')
    assert.equal(fs.existsSync(path.join(repoRoot, 'raw-report-pages')), false)
    assert.deepEqual(listRawReportPageFiles(), EXPECTED_CAPTURE_FILES)
})

test('raw report page captures retain Quora space-feed markers', () => {
    for(const summary of summarizeRawReportPages()) {
        for(const marker of SPACE_FEED_MARKERS) {
            assert.ok(
                summary.markerCounts[marker] > 0,
                `${summary.file} is missing ${marker}`
            )
        }
    }
})

test('raw report page captures retain canonical profile candidates', () => {
    for(const summary of summarizeRawReportPages()) {
        const minimum = expectedMinimumProfileCounts[summary.file]
        assert.ok(
            summary.profileHrefs.length >= minimum,
            `${summary.file} has only ${summary.profileHrefs.length} canonical profile hrefs`
        )
        assert.ok(
            summary.profileHrefs.includes(knownProfileSamples[summary.file]),
            `${summary.file} lost expected sample profile ${knownProfileSamples[summary.file]}`
        )
    }
})

;(async () => {
    for(const {name, fn} of tests) {
        try {
            await fn()
            console.log(`ok - ${name}`)
        }
        catch(error) {
            console.error(`not ok - ${name}`)
            throw error
        }
    }
})()
