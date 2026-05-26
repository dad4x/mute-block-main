const fs = require('node:fs')
const path = require('node:path')
const {
    normalizeQuoraProfileHref
} = require('../../shared/js/subject')

const RAW_REPORT_PAGES_DIR = path.join(__dirname, '..', 'fixtures', 'raw-report-pages')

const EXPECTED_CAPTURE_FILES = [
    'Anti Spam and Scam.html',
    'Instant Block.html',
    'Spam detectives.html',
    'Taking out the Trash.html',
    'The Obvious Troll shooting gallery.html',
    'The Original Whack-A-Troll\\u2122.html',
    'The Q defense crew...html',
    'Troll \\uD83E\\uDDCC Patrol.html',
    'Trolls galore.html',
    'Umm, no.html'
].map(value => JSON.parse(`"${value}"`))

const SPACE_FEED_MARKERS = [
    'TribeFeed',
    'puppeteer_test_link',
    'puppeteer_test_tribe_post_item_feed_story',
    'q-click-wrapper',
    'post_timestamp'
]

function listRawReportPageFiles(dir = RAW_REPORT_PAGES_DIR) {
    return fs.readdirSync(dir)
        .filter(file => file.endsWith('.html'))
        .sort()
}

function readRawReportPage(file, dir = RAW_REPORT_PAGES_DIR) {
    return fs.readFileSync(path.join(dir, file), 'utf8')
}

function decodeHtmlAttributeValue(value = '') {
    return `${value || ''}`
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
        .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
}

function extractHtmlAttributeValues(html = '', attributeName = 'href') {
    const values = []
    const pattern = new RegExp(`${attributeName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'gi')

    for(const match of `${html || ''}`.matchAll(pattern)) {
        values.push(decodeHtmlAttributeValue(match[1] || match[2] || match[3] || ''))
    }

    return values
}

function extractProfileHrefsFromHtml(html = '') {
    const seen = new Set()

    for(const href of extractHtmlAttributeValues(html, 'href')) {
        const normalized = normalizeQuoraProfileHref(href)
        if(normalized) seen.add(normalized)
    }

    return Array.from(seen).sort()
}

function countOccurrences(text = '', needle = '') {
    if(!needle) return 0

    let count = 0
    let index = 0
    while(true) {
        index = `${text || ''}`.indexOf(needle, index)
        if(index < 0) return count
        count += 1
        index += needle.length
    }
}

function summarizeRawReportPage(file, dir = RAW_REPORT_PAGES_DIR) {
    const html = readRawReportPage(file, dir)
    const markerCounts = {}

    for(const marker of SPACE_FEED_MARKERS) {
        markerCounts[marker] = countOccurrences(html, marker)
    }

    return {
        file,
        bytes: Buffer.byteLength(html),
        profileHrefs: extractProfileHrefsFromHtml(html),
        markerCounts
    }
}

function summarizeRawReportPages(dir = RAW_REPORT_PAGES_DIR) {
    return listRawReportPageFiles(dir).map(file => summarizeRawReportPage(file, dir))
}

module.exports = {
    EXPECTED_CAPTURE_FILES,
    RAW_REPORT_PAGES_DIR,
    SPACE_FEED_MARKERS,
    extractHtmlAttributeValues,
    extractProfileHrefsFromHtml,
    listRawReportPageFiles,
    readRawReportPage,
    summarizeRawReportPage,
    summarizeRawReportPages
}
