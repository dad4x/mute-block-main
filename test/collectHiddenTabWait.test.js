// A collect waits for its tab to be visible (31 Oct). A hidden tab does not load the next batch, so the wait must not be read as a stall.
// waitForSpaceFeedTabVisible is read out of content.js and run against a fake document; the loop wiring is checked in the source.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, '..', 'shared', 'js', 'content.js'), 'utf8')

function extractFunction(text, header) {
    const start = text.indexOf(header)
    if (start < 0) throw new Error(`missing ${header}`)
    let depth = 0
    let opened = false
    for (let i = text.indexOf(') {', start) + 2; i < text.length; i += 1) {
        if (text[i] === '{') { depth += 1; opened = true }
        if (text[i] === '}') { depth -= 1; if (opened && depth === 0) return text.slice(start, i + 1) }
    }
    throw new Error(`unterminated ${header}`)
}

function makeFakeDocument() {
    const listeners = new Map()
    return {
        visibilityState: 'hidden',
        addEventListener(type, fn) { listeners.set(type, [...(listeners.get(type) || []), fn]) },
        removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) || []).filter(l => l !== fn)) },
        fire(type) { for (const fn of listeners.get(type) || []) fn() },
        listenerCount(type) { return (listeners.get(type) || []).length }
    }
}

function makeContext(fakeDocument) {
    const context = vm.createContext({document: fakeDocument, spaceFeedCollectStopRequested: false, setInterval, clearInterval})
    vm.runInContext(extractFunction(source, 'function waitForSpaceFeedTabVisible() {'), context)
    return context
}

const tests = []
function test(name, fn) { tests.push({name, fn}) }

test('a hidden tab waits, and resolves once it is visible again', async () => {
    const doc = makeFakeDocument()
    const context = makeContext(doc)
    let resolved = false
    const waiting = vm.runInContext('waitForSpaceFeedTabVisible()', context).then(() => { resolved = true })
    await new Promise(r => setTimeout(r, 20))
    assert.equal(resolved, false, 'still hidden, so still waiting')
    doc.visibilityState = 'visible'
    doc.fire('visibilitychange')
    await waiting
    assert.equal(resolved, true)
    assert.equal(doc.listenerCount('visibilitychange'), 0, 'the listener is removed once it resolves')
})

test('a stop request ends the wait even while the tab is still hidden', async () => {
    const doc = makeFakeDocument()
    const context = makeContext(doc)
    const waiting = vm.runInContext('waitForSpaceFeedTabVisible()', context)
    context.spaceFeedCollectStopRequested = true
    doc.fire('visibilitychange')
    await waiting
    assert.equal(doc.visibilityState, 'hidden')
})

test('the collect loop waits for a hidden tab and does not read that wait as a stall', () => {
    assert.match(source, /if\(document\.visibilityState !== 'visible' && !spaceFeedCollectStopRequested\) \{\s*resumedFromHiddenTab = true/)
    assert.match(source, /setNukeButtonWorking\(collectButton, 'Paused: tab hidden'\)/)
    assert.match(source, /madeProgress: \(before, after\) => \{\s*const resumed = resumedFromHiddenTab/)
    assert.match(source, /return resumed \|\| collectPassMadeProgress\(before, after\)/)
})

;(async () => {
    for (const t of tests) {
        try {
            await t.fn()
            console.log(`ok - ${t.name}`)
        }
        catch (error) {
            console.error(`not ok - ${t.name}`)
            throw error
        }
    }
    console.log('collectHiddenTabWait: all tests passed')
})().catch(() => process.exit(1))
