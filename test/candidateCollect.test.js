// The Stop collecting label both collect pages share (shared/js/candidateCollect.js). These tests cover the label and elapsed-time text, and
// pin the collect loops' exit lines by text, so the counters added for the label cannot change when a run ends. The page wiring of the
// label (the timer, the counters and the shared helper call) is pinned in test/p1-contract.test.js and exercised in test/swSynthetic.test.js.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const {formatElapsed, formatCollectStopLabel, runCollectLoop, collectPassMadeProgress} = require('../shared/js/candidateCollect')

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

// The loop is async, so its tests run after the synchronous ones, in order, from the end of this file.
const asyncTests = []
function asyncTest(name, fn) {
    asyncTests.push({name, fn})
}

// The text of a function from its signature to its closing brace (the same brace count the synthetic harness uses).
function functionBody(source, signature) {
    const start = source.indexOf(signature)
    assert.notEqual(start, -1, `missing ${signature} in content.js`)
    const braceStart = source.indexOf('{', start + signature.length)
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

const contentSource = fs.readFileSync(path.join(__dirname, '..', 'shared/js/content.js'), 'utf8')
const candidateSource = fs.readFileSync(path.join(__dirname, '..', 'shared/js/candidateCollect.js'), 'utf8')
// The runner's source, from its signature to the exports. Its parameters are destructured, so functionBody cannot take it.
function runnerSource() {
    const start = candidateSource.indexOf('async function runCollectLoop({')
    assert.notEqual(start, -1, 'missing runCollectLoop in candidateCollect.js')
    return candidateSource.slice(start, candidateSource.indexOf('module.exports'))
}

test('formatElapsed gives m:ss with zero-padded seconds: 0 is 0:00, 65000 is 1:05, 600000 is 10:00', () => {
    assert.equal(formatElapsed(0), '0:00')
    assert.equal(formatElapsed(65000), '1:05')
    assert.equal(formatElapsed(600000), '10:00')
    assert.equal(formatElapsed(999), '0:00', 'a part second is not counted yet')
    assert.equal(formatElapsed(-5), '0:00', 'a negative elapsed time reads as 0:00')
})

test('the label is "N / M Stop collecting · S · m:ss", as produced for 12 collected of 100, 3 passes, 65 seconds', () => {
    assert.equal(
        formatCollectStopLabel({collected: 12, target: 100, passes: 3, elapsedMs: 65000}),
        '12 / 100 Stop collecting · 3 · 1:05'
    )
})

test('the label never says "scrolls", whatever the counts', () => {
    const labels = [
        formatCollectStopLabel({collected: 0, target: 25, passes: 0, elapsedMs: 0}),
        formatCollectStopLabel({collected: 12, target: 100, passes: 3, elapsedMs: 65000}),
        formatCollectStopLabel({collected: 1000, target: 1000, passes: 400, elapsedMs: 3600000})
    ]
    for(const label of labels) assert.doesNotMatch(label, /scroll/i, label)
    // The label's own function and text name no scroll either, so the word cannot reach the label through a later edit to this file.
    const labelSource = functionBody(fs.readFileSync(path.join(__dirname, '..', 'shared/js/candidateCollect.js'), 'utf8'), 'function formatCollectStopLabel(')
    assert.doesNotMatch(labelSource, /scroll/i)
})

test('the label reads zero and the minute mark for a run that has just started or is missing its numbers', () => {
    assert.equal(formatCollectStopLabel(), '0 / 0 Stop collecting · 0 · 0:00')
    assert.equal(formatCollectStopLabel({collected: -1, target: 'x', passes: 2.7, elapsedMs: 600000}), '0 / 0 Stop collecting · 2 · 10:00')
})

// The loop body moved to runCollectLoop (candidateCollect.js) in step 4. These pins keep the same conditions, now written as the page's
// callbacks and the runner's lines, so the rules cannot change without a test changing.
test('the space loop exit lines are unchanged: the run-state condition, the end-of-feed confirm, and the away-from-bottom stall', () => {
    const body = functionBody(contentSource, 'async function collectMoreSpaceFeedPosts(button)')
    const loop = runnerSource()
    assert.match(body, /isStopRequested: \(\) => spaceFeedCollectStopRequested,\s*isDone: \(\) => isSpaceFeedCollectDone\(startCount, peakCount, limit\),/)
    assert.match(body, /madeProgress: collectPassMadeProgress,/)
    assert.match(candidateSource, /return after\.count > before\.count \|\| after\.scrollY > before\.scrollY \|\| after\.scrollHeight > before\.scrollHeight/)
    assert.match(body, /endCheck: stalledMs => atFeedBottom\(\) && stalledMs >= COLLECT_END_CONFIRM_MS,/)
    assert.match(body, /stallTimeoutApplies: \(\) => !atFeedBottom\(\),/)
    assert.match(body, /stallTimeoutMs: COLLECT_STALLED_TIMEOUT_MS/)
    assert.match(loop, /while\(!isStopRequested\(\) && !isDone\(\)\) \{/)
    assert.match(loop, /if\(endCheck\(stalledMs\)\) return 'end'/)
    assert.match(loop, /if\(stallTimeoutApplies\(\) && stalledMs >= stallTimeoutMs\) \{/)
})

test('the search loop exit lines are unchanged: the stop and limit condition, the end-of-results return, and the stall timeout', () => {
    const body = functionBody(contentSource, 'async function collectMoreProfileSearchResults(button)')
    const loop = runnerSource()
    assert.match(body, /isStopRequested: \(\) => profileSearchCollectStopRequested,\s*isDone: \(\) => collectedCount >= limit,/)
    assert.match(body, /if\(collectedCount >= limit\) return 'done'/)
    assert.match(body, /if\(isProfileSearchEndOfResultsVisible\(\) && !hasUnstagedProfileSearchQueueableRow\(\) && !hasProfileSearchLoadingIndicator\(\)\) return 'end'/)
    assert.match(body, /madeProgress: collectPassMadeProgress,/)
    assert.match(body, /stallTimeoutMs: COLLECT_STALLED_TIMEOUT_MS/)
    assert.doesNotMatch(body, /stallTimeoutApplies/, 'the search page checks its stall at any position')
    assert.match(loop, /while\(!isStopRequested\(\) && !isDone\(\)\) \{/)
    assert.match(loop, /if\(stallTimeoutApplies\(\) && stalledMs >= stallTimeoutMs\) \{/)
})

test('each collect loop writes its pass count and collected count once per pass, and the run start resets them', () => {
    const space = functionBody(contentSource, 'async function collectMoreSpaceFeedPosts(button)')
    const search = functionBody(contentSource, 'async function collectMoreProfileSearchResults(button)')
    assert.equal((space.match(/spaceFeedCollectProgress\.passes \+= 1/g) || []).length, 1)
    assert.equal((space.match(/spaceFeedCollectProgress\.collected = /g) || []).length, 1)
    assert.equal((search.match(/profileSearchCollectProgress\.passes \+= 1/g) || []).length, 1)
    assert.equal((search.match(/profileSearchCollectProgress\.collected = collectedCount/g) || []).length, 1)
})

test('collectPassMadeProgress is true when the count, the scroll or the height grew, and false when none did', () => {
    const still = {count: 4, scrollY: 100, scrollHeight: 900}
    assert.equal(collectPassMadeProgress(still, {...still}), false)
    assert.equal(collectPassMadeProgress(still, {...still, count: 5}), true)
    assert.equal(collectPassMadeProgress(still, {...still, scrollY: 101}), true)
    assert.equal(collectPassMadeProgress(still, {...still, scrollHeight: 901}), true)
})

// A fake page for the loop. The clock moves only with the wait, so the stall clock is exact: a silent pass after a 500 ms wait is 500 ms
// later than the one before. progressOn(pass) says whether that pass moves the page (its count and scroll both go up).
function loopFixture({progressOn = () => false, stopOn = 0, limit = Infinity, passResult = () => undefined, endCheck, stallTimeoutApplies} = {}) {
    const page = {clock: 0, passes: 0, reads: 0, stalls: 0, count: 0, scrollY: 0, stop: false, log: []}
    const options = {
        isStopRequested: () => page.stop,
        isDone: () => page.count >= limit,
        snapshot: () => {
            page.log.push('snapshot')
            return {count: page.count, scrollY: page.scrollY, scrollHeight: 1000}
        },
        pass: () => {
            page.passes += 1
            page.log.push('pass')
            if(progressOn(page.passes)) {
                page.count += 1
                page.scrollY += 1
            }
            return passResult(page.passes)
        },
        sleep: async ms => {
            page.log.push('sleep')
            page.clock += ms
            if(page.passes === stopOn) page.stop = true
        },
        waitMs: 500,
        readProgress: () => {
            page.reads += 1
            page.log.push('read')
        },
        madeProgress: collectPassMadeProgress,
        stallTimeoutMs: 3000,
        onStall: () => { page.stalls += 1 },
        now: () => page.clock
    }
    if(endCheck) options.endCheck = endCheck
    if(stallTimeoutApplies) options.stallTimeoutApplies = stallTimeoutApplies
    return {page, options, run: () => runCollectLoop(options)}
}

asyncTest('runCollectLoop stops when isDone is true, before any pass when it starts true, and after the pass that makes it true', async() => {
    const already = loopFixture({limit: 0})
    assert.equal(await already.run(), null)
    assert.equal(already.page.passes, 0, 'no pass runs when isDone is true from the start')

    const reached = loopFixture({limit: 3, progressOn: () => true})
    assert.equal(await reached.run(), null, 'the loop ends by isDone, not by a rule')
    assert.equal(reached.page.passes, 3, 'three passes raise the count to 3, and no fourth pass starts')
    assert.equal(reached.page.stalls, 0)
})

asyncTest('runCollectLoop stops when the stop flag is set, before the next pass starts', async() => {
    const stopped = loopFixture({stopOn: 2})
    assert.equal(await stopped.run(), null)
    assert.equal(stopped.page.passes, 2, 'the stop is set during the wait of pass 2, so pass 3 never starts')
    assert.equal(stopped.page.stalls, 0)
})

asyncTest('runCollectLoop ends with the stall on onStall when the page is silent for the stall timeout', async() => {
    // Pass 1 starts the stall clock at 500 ms. Pass k reads a stall of 500 * (k - 1) ms, so 3000 ms comes at pass 7.
    const silent = loopFixture()
    assert.equal(await silent.run(), 'stalled')
    assert.equal(silent.page.passes, 7)
    assert.equal(silent.page.stalls, 1, 'onStall is called once')
})

asyncTest('runCollectLoop: progress restarts the stall clock, so a silent run after progress takes the timeout again from the next silent pass', async() => {
    // Pass 3 moves the page, which clears the clock. Pass 4 starts it again, and the stall comes 6 silent passes later, at pass 10.
    // Without the progress at pass 3 the same run would stop at pass 7.
    const restarted = loopFixture({progressOn: passes => passes === 3})
    assert.equal(await restarted.run(), 'stalled')
    assert.equal(restarted.page.passes, 10)
    assert.equal(restarted.page.stalls, 1)
})

asyncTest('runCollectLoop ends at the bottom when endCheck is true, and does not call onStall', async() => {
    // The space page's rule at the bottom: endCheck is true once the stall has run 3000 ms, and the stall timeout does not apply there.
    const atBottom = true
    const bottom = loopFixture({
        endCheck: stalledMs => atBottom && stalledMs >= 3000,
        stallTimeoutApplies: () => !atBottom
    })
    assert.equal(await bottom.run(), 'end')
    assert.equal(bottom.page.passes, 7, 'the end comes at the same pass the stall would')
    assert.equal(bottom.page.stalls, 0, 'onStall is not called at the bottom')

    // Away from the bottom, the same endCheck is false and the stall timeout applies, so the run is stalled, not ended.
    const away = loopFixture({
        endCheck: stalledMs => false,
        stallTimeoutApplies: () => true
    })
    assert.equal(await away.run(), 'stalled')
    assert.equal(away.page.stalls, 1)
})

asyncTest('runCollectLoop returns end or done as soon as the pass says so, with no wait after that pass', async() => {
    const ended = loopFixture({passResult: passes => (passes === 2 ? 'end' : undefined)})
    assert.equal(await ended.run(), 'end')
    assert.equal(ended.page.passes, 2)
    assert.equal(ended.page.log.filter(step => step === 'sleep').length, 1, 'only pass 1 waits; pass 2 ends before its wait')

    const finished = loopFixture({passResult: passes => (passes === 2 ? 'done' : undefined)})
    assert.equal(await finished.run(), 'done')
    assert.equal(finished.page.log.filter(step => step === 'sleep').length, 1)
})

asyncTest('runCollectLoop runs each pass as snapshot, pass, wait, read, snapshot, in that order', async() => {
    const once = loopFixture({progressOn: () => true, limit: 1})
    assert.equal(await once.run(), null)
    assert.deepEqual(once.page.log.slice(0, 5), ['snapshot', 'pass', 'sleep', 'read', 'snapshot'])
})

const asyncRunner = (async() => {
    for(const {name, fn} of asyncTests) {
        try {
            await fn()
            console.log(`ok - ${name}`)
        }
        catch(error) {
            console.error(`not ok - ${name}`)
            throw error
        }
    }
    console.log('candidateCollect tests passed')
})()
asyncRunner.catch(error => {
    console.error(error)
    process.exitCode = 1
})
