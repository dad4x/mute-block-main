const assert = require('node:assert/strict')
const {loadServiceWorkerHarness} = require('./lib/swHarness')
const m = require('../shared/js/spaceMapStorage')

const NUKED = 'mbSpaceNukedPosts'
const PENDING = 'mbSpacePendingNukedPosts'
const NOW = 5000

function posts(prefix, n) {
    const out = {}
    for(let i = 0; i < n; i += 1) {
        const postKey = `${prefix}-${i}`
        out[`https://www.quora.com/space/${postKey}`] = {postKey, postUrl: `https://www.quora.com/space/${postKey}`, updatedAt: NOW - 1000 - i, urls: [`https://www.quora.com/u-${postKey}`]}
    }
    return out
}

async function settle(ticks = 500) {
    for (let tick = 0; tick < ticks; tick += 1) await Promise.resolve()
}

// Records the keys of every storage.local.set made while fn runs.
async function recordSetKeys(browser, fn) {
    const original = browser.storage.local.set.bind(browser.storage.local)
    const keys = []
    browser.storage.local.set = async payload => {
        keys.push(...Object.keys(payload || {}))
        return original(payload)
    }
    try {
        await fn()
    }
    finally {
        browser.storage.local.set = original
    }
    return keys
}

const cases = []
const test = (name, fn) => cases.push([name, fn])

async function run(name, fn) {
    try {
        await fn()
        console.log(`ok - ${name}`)
    }
    catch(error) {
        console.log(`not ok - ${name}`)
        console.log(error?.stack || error)
        process.exitCode = 1
    }
}

test('startup moves both maps to the bucketed layout and keeps the legacy keys', async () => {
    const nuked = posts('nuked', 40)
    const pending = posts('pending', 12)
    const {browser, sw} = loadServiceWorkerHarness({
        now: NOW,
        runStartupWork: true,
        storage: {[NUKED]: nuked, [PENDING]: pending}
    })
    await sw.coordinatorAuthority.hydrate()
    await settle()
    assert.equal(browser.__storage[m.SPACE_MAP_LAYOUT_KEY], m.SPACE_MAP_LAYOUT_BUCKETED, 'the layout marker is written')
    assert.deepEqual(m.readSpaceMapFromStored(browser.__storage, NUKED), nuked, 'the buckets hold every nuked post')
    assert.deepEqual(m.readSpaceMapFromStored(browser.__storage, PENDING), pending, 'the buckets hold every pending record')
    assert.deepEqual(browser.__storage[NUKED], nuked, 'the legacy nuked key is kept for a rollback')
    assert.deepEqual(browser.__storage[PENDING], pending, 'the legacy pending key is kept for a rollback')
})

test('after the migration, a write that changes one nuked post sends one bucket and no whole-map key', async () => {
    const nuked = posts('nuked', 40)
    const {browser, sw} = loadServiceWorkerHarness({
        now: NOW,
        runStartupWork: true,
        storage: {[NUKED]: nuked, [PENDING]: posts('pending', 3)}
    })
    await sw.coordinatorAuthority.hydrate()
    await settle()
    const current = sw.coordinatorAuthority.current().stored[NUKED]
    const changedKey = Object.keys(current)[0]
    const next = {...current, [changedKey]: {...current[changedKey], updatedAt: NOW}}
    const keys = await recordSetKeys(browser, async () => {
        await sw.coordinatorAuthority.persistCoordinator({stored: {[NUKED]: next}}, {
            storageOptions: {metricPath: 'test.spaceMap.write', queueOperation: 'terminal-settlement-derived', queueChangedRows: 0}
        })
    })
    const bucket = m.spaceMapBucketKey(NUKED, m.spaceMapBucketIndex(changedKey))
    assert.deepEqual(keys.filter(key => key.startsWith(`${NUKED}.b`)), [bucket], 'only the bucket of the changed post is written')
    assert.equal(keys.includes(NUKED), false, 'the whole nuked map is not written')
    assert.equal(keys.includes(PENDING), false, 'the pending map is not written by a nuked write')
    assert.equal(m.readSpaceMapFromStored(browser.__storage, NUKED)[changedKey].updatedAt, NOW, 'the change is on disk')
})

test('a restart with the bucketed layout reads the same maps back', async () => {
    const nuked = posts('nuked', 25)
    const pending = posts('pending', 6)
    const first = loadServiceWorkerHarness({now: NOW, runStartupWork: true, storage: {[NUKED]: nuked, [PENDING]: pending}})
    await first.sw.coordinatorAuthority.hydrate()
    await settle()
    const restarted = loadServiceWorkerHarness({now: NOW + 1000, browser: first.browser})
    await restarted.sw.coordinatorAuthority.hydrate()
    // The worker runs in its own script context, so its objects have another prototype: compare plain JSON copies.
    const stored = JSON.parse(JSON.stringify(restarted.sw.coordinatorAuthority.current().stored))
    assert.deepEqual(stored[NUKED], nuked)
    assert.deepEqual(stored[PENDING], pending)
})

;(async () => {
    for (const [name, fn] of cases) await run(name, fn)
})().catch(() => {
    process.exitCode = 1
})
