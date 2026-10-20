const assert = require('node:assert/strict')
const m = require('../shared/js/spaceMapStorage')

const NUKED = 'mbSpaceNukedPosts'
const PENDING = 'mbSpacePendingNukedPosts'

function posts(prefix, n) {
    const out = {}
    for(let i = 0; i < n; i += 1) out[`https://www.quora.com/${prefix}-${i}`] = {postKey: `${prefix}-${i}`, updatedAt: 1000 + i}
    return out
}

function asStored(baseKey, map) {
    const stored = {[m.SPACE_MAP_LAYOUT_KEY]: m.SPACE_MAP_LAYOUT_BUCKETED}
    const buckets = m.splitSpaceMapIntoBuckets(baseKey, map)
    return Object.assign(stored, buckets)
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

test('there are 32 distinct bucket keys per map, named under the map key', () => {
    const keys = m.spaceMapBucketKeys(NUKED)
    assert.equal(keys.length, 32)
    assert.equal(new Set(keys).size, 32)
    assert.equal(keys[0], 'mbSpaceNukedPosts.b00')
    assert.equal(keys[31], 'mbSpaceNukedPosts.b1f')
})

test('a bucketed map reads back to the same map', () => {
    const map = posts('a', 200)
    assert.deepEqual(m.readSpaceMapFromStored(asStored(NUKED, map), NUKED), map)
})

test('the same post always lands in the same bucket', () => {
    assert.equal(m.spaceMapBucketIndex('https://www.quora.com/x'), m.spaceMapBucketIndex('https://www.quora.com/x'))
})

test('without the layout marker the legacy whole-map key is the truth, and bucket keys are ignored', () => {
    const legacy = posts('legacy', 3)
    const stored = {[NUKED]: legacy, ...m.splitSpaceMapIntoBuckets(NUKED, posts('stale', 5))}
    assert.deepEqual(m.readSpaceMapFromStored(stored, NUKED), legacy)
    assert.deepEqual(m.readSpaceMapFromStored({}, NUKED), {})
    assert.deepEqual(m.readSpaceMapFromStored({[NUKED]: 'not a map'}, NUKED), {})
})

test('with no previous hashes every bucket is written (the migration case)', () => {
    const {changed} = m.changedSpaceMapBuckets(NUKED, posts('a', 10), null)
    assert.equal(Object.keys(changed).length, 32)
})

test('an unchanged map writes no bucket', () => {
    const map = posts('a', 50)
    const first = m.changedSpaceMapBuckets(NUKED, map, null)
    const second = m.changedSpaceMapBuckets(NUKED, map, first.hashes)
    assert.deepEqual(second.changed, {})
})

test('one post added changes exactly its own bucket', () => {
    const map = posts('a', 50)
    const first = m.changedSpaceMapBuckets(NUKED, map, null)
    const added = {...map, 'https://www.quora.com/new-post': {postKey: 'new-post', updatedAt: 9999}}
    const second = m.changedSpaceMapBuckets(NUKED, added, first.hashes)
    const expected = m.spaceMapBucketKey(NUKED, m.spaceMapBucketIndex('https://www.quora.com/new-post'))
    assert.deepEqual(Object.keys(second.changed), [expected])
    assert.equal(second.changed[expected]['https://www.quora.com/new-post'].updatedAt, 9999)
})

test('removing the last post of a bucket writes that bucket empty', () => {
    const map = {'https://www.quora.com/only': {postKey: 'only', updatedAt: 1}}
    const first = m.changedSpaceMapBuckets(PENDING, map, null)
    const second = m.changedSpaceMapBuckets(PENDING, {}, first.hashes)
    const bucket = m.spaceMapBucketKey(PENDING, m.spaceMapBucketIndex('https://www.quora.com/only'))
    assert.deepEqual(Object.keys(second.changed), [bucket])
    assert.deepEqual(second.changed[bucket], {})
})

;(async () => {
    for (const [name, fn] of cases) await run(name, fn)
})().catch(() => {
    process.exitCode = 1
})
