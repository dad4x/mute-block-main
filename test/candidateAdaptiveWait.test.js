// The adaptive pause between collect passes (1 Nov): a pass that grows the list shortens the next pause, a silent pass doubles it up to a
// ceiling, and the silent passes in a row are counted so a list still loading is not read as its end. These tests run the wait on its own.
const assert = require('node:assert/strict')

const {createAdaptiveCollectWait, runCollectLoop} = require('../shared/js/candidateCollect')

async function test(name, fn) {
    try {
        await fn()
        console.log(`ok - ${name}`)
    }
    catch(error) {
        console.error(`not ok - ${name}`)
        throw error
    }
}

test('the pause starts at the floor and a silent pass doubles it, up to the ceiling', () => {
    const wait = createAdaptiveCollectWait({floorMs: 500, ceilingMs: 2000})
    assert.equal(wait.current(), 500)
    wait.observe(false)
    assert.equal(wait.current(), 1000)
    wait.observe(false)
    assert.equal(wait.current(), 2000)
    wait.observe(false)
    assert.equal(wait.current(), 2000)
})

test('a pass that grew the list shortens the pause to three quarters, not below the floor', () => {
    const wait = createAdaptiveCollectWait({floorMs: 500, ceilingMs: 10000})
    wait.observe(false)
    wait.observe(false)
    assert.equal(wait.current(), 2000)
    wait.observe(true)
    assert.equal(wait.current(), 1500)
    for(let i = 0; i < 20; i += 1) wait.observe(true)
    assert.equal(wait.current(), 500)
})

test('silent passes in a row are counted, and a pass that grows the list resets the count', () => {
    const wait = createAdaptiveCollectWait({floorMs: 500, ceilingMs: 10000})
    assert.equal(wait.silentPasses(), 0)
    wait.observe(false)
    wait.observe(false)
    assert.equal(wait.silentPasses(), 2)
    wait.observe(true)
    assert.equal(wait.silentPasses(), 0)
})

test('the collect loop takes its pause from a function, and reports each pass to onPass', async () => {
    const waits = []
    const passes = []
    let count = 0
    let reads = 0
    const wait = createAdaptiveCollectWait({floorMs: 1, ceilingMs: 4})
    const outcome = await runCollectLoop({
        isStopRequested: () => false,
        isDone: () => reads >= 3,
        snapshot: () => ({count, scrollY: 0, scrollHeight: 0}),
        pass: () => {},
        sleep: async ms => { waits.push(ms) },
        waitMs: () => wait.current(),
        readProgress: () => {
            reads += 1
            count += reads === 2 ? 0 : 10
        },
        madeProgress: (before, after) => after.count > before.count,
        onPass: made => {
            passes.push(made)
            wait.observe(made)
        },
        endCheck: () => false,
        stallTimeoutMs: 1e9
    })
    assert.equal(outcome, null)
    assert.deepEqual(passes, [true, false, true])
    // The pause before each pass: 1 (floor), 1 (the pass that grew kept it at the floor), then 2 (the silent pass doubled it).
    assert.deepEqual(waits, [1, 1, 2])
})
