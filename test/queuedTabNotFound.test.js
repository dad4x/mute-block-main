// A queued tab whose main frame returns HTTP 404 is recorded at once as notfound-404. Quora's not-found page has no content script,
// so the row can't wait for a reply from the tab. These tests read the wiring in shared/js/swBootstrap.js and shared/js/sw.js.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

async function test(name, fn) {
    try {
        await fn()
        console.log(`ok - ${name}`)
    }
    catch (error) {
        console.error(`not ok - ${name}`)
        console.error(error)
        process.exitCode = 1
    }
}

const bootstrap = readRepoFile('shared/js/swBootstrap.js')
const sw = readRepoFile('shared/js/sw.js')

test('the bootstrap listens for main-frame responses and records only 404', () => {
    const start = bootstrap.indexOf('browser.webRequest.onCompleted.addListener(details => {\n        if(details.statusCode !== 404')
    assert.notEqual(start, -1, 'missing the 404 main-frame listener')
    const block = bootstrap.slice(start, bootstrap.indexOf('}, {urls:', start) + 60)
    assert.match(block, /types: \['main_frame'\]/)
    assert.match(block, /recordQueuedTabNotFound\(details\.tabId, details\.url\)/)
})

test('the bootstrap reads the dependency optionally, so a missing dep is a no-op', () => {
    assert.match(bootstrap, /const recordQueuedTabNotFound = typeof deps\.recordQueuedTabNotFound === 'function'/)
})

test('sw.js passes the handler into the listener deps', () => {
    const deps = sw.slice(sw.indexOf('registerServiceWorkerListeners({'), sw.indexOf('registerServiceWorkerListeners({') + 200)
    assert.match(deps, /recordQueuedTabNotFound,/)
})

test('the notfound-404 outcome is a named constant used by the handler and the profile event', () => {
    assert.match(sw, /const QUEUED_TAB_NOTFOUND_OUTCOME = 'notfound-404'/)
    const fn = sw.slice(sw.indexOf('async function recordQueuedTabNotFound('), sw.indexOf('async function markQueuedProfileResolutionUnresolved('))
    assert.match(fn, /outcome: QUEUED_TAB_NOTFOUND_OUTCOME/)
    assert.match(fn, /reason: QUEUED_TAB_NOTFOUND_OUTCOME/)
    assert.match(sw, /reason === QUEUED_TAB_NOTFOUND_OUTCOME\s*\?\s*'Quora returned 404 for this profile; skipped, not blocked'/)
})

test('a resolve row goes through the resolver path, a profile row through the profile-unavailable path, and the tab is closed', () => {
    const fn = sw.slice(sw.indexOf('async function recordQueuedTabNotFound('), sw.indexOf('async function markQueuedProfileResolutionUnresolved('))
    assert.match(fn, /coordinatorKey\.startsWith\('resolve-profile:'\)/)
    assert.match(fn, /markQueuedProfileResolutionUnresolved\(\{/)
    assert.match(fn, /resolveActiveQueuedActionForBlockedPageEvent\(normalizedTabId\)/)
    assert.match(fn, /recordProfileUnavailableFromPage\(active\.itemKey/)
    assert.match(fn, /closeQueuedTabAfterTerminal\(normalizedTabId, QUEUED_TAB_NOTFOUND_OUTCOME/)
})

test('only 404 is special-cased: other status codes do not reach the handler', () => {
    const start = bootstrap.indexOf('browser.webRequest.onCompleted.addListener(details => {\n        if(details.statusCode !== 404')
    const guard = bootstrap.slice(start, start + 200)
    assert.match(guard, /if\(details\.statusCode !== 404 \|\| details\.tabId < 0\) return/)
})

// The skipped breakdown names a 404 by its reason, and the old banned and deactivated names keep their own buckets.
const {mapProgressToJobState} = require('../shared/js/jobState')

test('a notfound-404 reason is the skipped outcome as written, not profile-unavailable', () => {
    const mapped = mapProgressToJobState({status: 'profile-unavailable', unavailableReason: 'notfound-404', finalError: 'x'})
    assert.equal(mapped.status, 'skipped')
    assert.equal(mapped.outcome, 'notfound-404')
})

test('banned and deactivated keep their buckets, and other reasons still land on profile-unavailable', () => {
    assert.equal(mapProgressToJobState({status: 'profile-unavailable', unavailableReason: 'Profile banned'}).outcome, 'banned')
    assert.equal(mapProgressToJobState({status: 'profile-unavailable', unavailableReason: 'Profile deactivated'}).outcome, 'deactivated')
    assert.equal(mapProgressToJobState({status: 'profile-unavailable', unavailableReason: 'Page Not Found'}).outcome, 'profile-unavailable')
})
