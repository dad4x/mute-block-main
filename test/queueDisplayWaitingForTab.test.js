// The queue display (31 Oct): an active row with no tab is waiting for the worker surface, so it shows as queued and is counted as ready.
// The stored status is not changed. The helpers are read out of coordinator.js and run here; the count rule is checked in its source.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const coordinatorSource = fs.readFileSync(path.join(__dirname, '..', 'shared', 'js', 'coordinator.js'), 'utf8')
const queueViewSource = fs.readFileSync(path.join(__dirname, '..', 'shared', 'js', 'swCoordinatorQueueView.js'), 'utf8')

// Pulls one top-level function out of a source file by its header, matching braces.
function extractFunction(text, header) {
    const start = text.indexOf(header)
    if (start < 0) throw new Error(`missing ${header}`)
    let depth = 0
    let opened = false
    for (let i = text.indexOf(") {", start) + 2; i < text.length; i += 1) {
        if (text[i] === '{') { depth += 1; opened = true }
        if (text[i] === '}') { depth -= 1; if (opened && depth === 0) return text.slice(start, i + 1) }
    }
    throw new Error(`unterminated ${header}`)
}

const context = vm.createContext({
    isActiveCoordinatorStatus: status => ['opening', 'active', 'acting', 'settling'].includes(status)
})
vm.runInContext(extractFunction(coordinatorSource, 'function isActiveQueueItem(item = {}) {'), context)
vm.runInContext(extractFunction(coordinatorSource, 'function isWaitingForTabQueueItem(item = {}) {'), context)
vm.runInContext(extractFunction(coordinatorSource, 'function getDisplayedQueueStatus(item = {}) {'), context)

const displayed = item => vm.runInContext('getDisplayedQueueStatus(item)', Object.assign(context, {item}))
const waiting = item => vm.runInContext('isWaitingForTabQueueItem(item)', Object.assign(context, {item}))

function test(name, fn) {
    try {
        fn()
        console.log(`ok - ${name}`)
    }
    catch (error) {
        console.error(`not ok - ${name}`)
        throw error
    }
}

test('an active row with no tab shows as queued', () => {
    assert.equal(displayed({status: 'active', tabId: null}), 'queued')
    assert.equal(waiting({status: 'active', tabId: null}), true)
})

test('an active row with a tab keeps its active status', () => {
    assert.equal(displayed({status: 'active', tabId: 751661667}), 'active')
    assert.equal(waiting({status: 'active', tabId: 751661667}), false)
})

test('other statuses are unchanged, and a missing status reads as unknown', () => {
    assert.equal(displayed({status: 'queued'}), 'queued')
    assert.equal(displayed({status: 'succeeded', tabId: null}), 'succeeded')
    assert.equal(displayed({}), 'unknown')
})

test('the dashboard row and the header count use the same waiting rule', () => {
    assert.match(coordinatorSource, /buildBadge\(getDisplayedQueueStatus\(item\)/)
    assert.match(coordinatorSource, /const activeAt = isWaitingForTabQueueItem\(item\) \? 0/)
    assert.match(queueViewSource, /const waitingForTab = Object\.values\(queue \|\| \{\}\)\.filter\(item => item\?\.status === 'active' && !item\?\.tabId\)\.length/)
    assert.match(queueViewSource, /const ready = \(Number\(counts\.queued\) \|\| 0\) \+ waitingForTab/)
})

console.log('queueDisplayWaitingForTab: all tests passed')
