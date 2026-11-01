// The queue bar's summary (historical/coder-instructions-2026-10-18.md, section 4 item 2; decisions 9 and 11). Pure functions and the push, with
// no service worker: the summary is built from a queue view, recorded, and displayed only while work is pending and some has
// finished. A change of total or pending is pushed to Quora tabs with tabs.sendMessage; a failed tab is skipped.
const assert = require('node:assert/strict')
const {
    QUEUE_BAR_GET_ACTION,
    QUEUE_BAR_PUSH_ACTION,
    summarizeQueueBarView,
    recordQueueBarSummary,
    getQueueBarSummary,
    getQueueBarDisplay,
    subscribeQueueBarTab,
    getQueueBarSubscriberTabIds,
    pushQueueBarSummary
} = require('../shared/js/swQueueBarSummary')

const tests = []
function test(name, fn) {
    tests.push({name, fn})
}

test('the summary counts the pending statuses of the view and nothing else', () => {
    const view = {
        total: 9,
        items: [{}],
        counts: {queued: 2, opening: 1, active: 1, acting: 1, settling: 1, succeeded: 2, failed: 1}
    }
    assert.deepEqual(summarizeQueueBarView(view, 500), {total: 9, pending: 6, updatedAt: 500})
})

test('a view without an items array counts as no view: total 0 and pending 0', () => {
    assert.deepEqual(summarizeQueueBarView({total: 4, counts: {queued: 4}}, 7), {total: 0, pending: 0, updatedAt: 7})
    assert.deepEqual(summarizeQueueBarView(null, 7), {total: 0, pending: 0, updatedAt: 7})
})

test('the summary is clamped to whole non-negative numbers', () => {
    assert.deepEqual(summarizeQueueBarView({total: '12', items: [], counts: {queued: '3'}}, 1), {total: 12, pending: 3, updatedAt: 1})
    const negative = recordQueueBarSummary({total: -4, pending: -1, updatedAt: 2}).summary
    assert.deepEqual(negative, {total: 0, pending: 0, updatedAt: 2})
})

test('recording reports a change only when total or pending moves, not when updatedAt does', () => {
    recordQueueBarSummary({total: 5, pending: 2, updatedAt: 1})
    assert.equal(recordQueueBarSummary({total: 5, pending: 2, updatedAt: 99}).changed, false)
    assert.equal(recordQueueBarSummary({total: 5, pending: 1, updatedAt: 100}).changed, true)
    assert.equal(recordQueueBarSummary({total: 6, pending: 1, updatedAt: 101}).changed, true)
    assert.deepEqual(getQueueBarSummary(), {total: 6, pending: 1, updatedAt: 101})
})

test('the bar is shown while work is queued and the queue is not paused, and hidden when nothing is queued (decision 13)', () => {
    assert.equal(getQueueBarDisplay({total: 5, pending: 3}, false).visible, true)
    assert.equal(getQueueBarDisplay({total: 5, pending: 3}, true).visible, false, 'paused hides the bar')
    assert.equal(getQueueBarDisplay({total: 5, pending: 0}, false).visible, false, 'done hides the bar')
    assert.equal(getQueueBarDisplay({total: 0, pending: 0}, false).visible, false, 'nothing queued hides the bar')
    assert.equal(getQueueBarDisplay(null, false).visible, false, 'a failed read or no summary hides the bar')
    // Decision 13: queued work with nothing finished yet shows 0/total.
    assert.equal(getQueueBarDisplay({total: 5, pending: 5}, false).visible, true, 'queued work shows 0/total')
})

test('the bar shows the finished share of the total, from 0%', () => {
    assert.deepEqual(getQueueBarDisplay({total: 8, pending: 6}, false), {visible: true, total: 8, terminal: 2, percent: 25})
    assert.equal(getQueueBarDisplay({total: 3, pending: 1}, false).percent, 67)
    assert.equal(getQueueBarDisplay({total: 5, pending: 5}, false).percent, 0)
})

test('a push reaches only the tabs that asked for the summary, and a tab that rejects is dropped from the set (decision 15)', async () => {
    // Only tabs 11 and 12 ask. Tab 12 later rejects a push, so it leaves the set and tab 13 (which never asked) is never sent to.
    subscribeQueueBarTab(11)
    subscribeQueueBarTab(12)
    subscribeQueueBarTab(undefined)
    subscribeQueueBarTab(null)
    assert.deepEqual(getQueueBarSubscriberTabIds(), [11, 12])
    const sent = []
    const browser = {
        tabs: {
            sendMessage: async (tabId, message) => {
                sent.push({tabId, message})
                if(tabId === 12) throw new Error('no receiver')
            }
        }
    }
    const summary = {total: 4, pending: 1, updatedAt: 3}
    const delivered = await pushQueueBarSummary(browser, summary)
    assert.equal(delivered, 1)
    assert.deepEqual(sent.map(entry => entry.tabId), [11, 12])
    assert.deepEqual(sent[0].message, {action: QUEUE_BAR_PUSH_ACTION, summary})
    assert.deepEqual(getQueueBarSubscriberTabIds(), [11])
    assert.equal(sent.some(entry => entry.tabId === 13), false)
})

test('a push with no subscribers sends nothing, and a tabs API that throws is dropped without throwing', async () => {
    assert.equal(await pushQueueBarSummary({tabs: {sendMessage: async () => { throw new Error('never called') }}}, {total: 1, pending: 1, updatedAt: 0}), 0)
    subscribeQueueBarTab(21)
    const throwing = {tabs: {sendMessage: () => { throw new Error('gone') }}}
    assert.equal(await pushQueueBarSummary(throwing, {total: 1, pending: 1, updatedAt: 0}), 0)
    assert.deepEqual(getQueueBarSubscriberTabIds(), [])
})

test('the message names are distinct and fixed', () => {
    assert.equal(QUEUE_BAR_GET_ACTION, 'get-queue-bar-summary')
    assert.equal(QUEUE_BAR_PUSH_ACTION, 'queue-bar-summary-pushed')
})

// The content side: refreshContentProgressBar, run from its source with stubs for the page and the message channel.
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

function extractContentRefresh() {
    const source = readRepoFile('shared/js/content.js')
    const signature = 'async function refreshContentProgressBar(pushedSummary = undefined)'
    const start = source.indexOf(signature)
    assert.notEqual(start, -1, 'refreshContentProgressBar is present')
    const braceStart = source.indexOf('{', start + signature.length)
    let depth = 0
    for(let index = braceStart; index < source.length; index += 1) {
        if(source[index] === '{') depth += 1
        else if(source[index] === '}') {
            depth -= 1
            if(depth === 0) return source.slice(start, index + 1)
        }
    }
    throw new Error('unterminated refreshContentProgressBar')
}

// Runs the content refresh once. The worker answers `reply` (or rejects when `reply` is an Error), and the page stores `paused`.
async function runContentRefresh({reply = null, paused = false, pushedSummary = undefined}) {
    const calls = {sent: 0, bar: 0, removed: 0, width: null, text: null}
    const fill = {style: {width: ''}}
    const count = {textContent: ''}
    const bar = {querySelector: selector => (selector.endsWith('-fill') ? fill : count)}
    const context = vm.createContext({
        document: {body: {}},
        safeStorageGet: async () => ({mbCoordinatorPaused: paused}),
        COORDINATOR_PAUSED_KEY: 'mbCoordinatorPaused',
        QUEUE_BAR_GET_ACTION,
        CONTENT_PROGRESS_BAR_ID: 'mb-progress',
        getQueueBarDisplay,
        getOrCreateContentProgressBar: () => { calls.bar += 1; return bar },
        removeContentProgressBar: () => { calls.removed += 1 },
        // The Nuking drop-down takes the stored pause flag from the same read (28 Oct); this harness only checks the bar.
        setNukingQueuePaused: () => {},
        browser: {
            runtime: {
                sendMessage: async () => {
                    calls.sent += 1
                    if(reply instanceof Error) throw reply
                    return reply
                }
            }
        },
        pushedSummary
    })
    await vm.runInContext(`(${extractContentRefresh()})(pushedSummary)`, context)
    calls.width = fill.style.width
    calls.text = count.textContent
    return calls
}

test('the content bar shows the summary the worker answers: 0/total while queued, with the finished share as its width', async () => {
    const shown = await runContentRefresh({reply: {summary: {total: 4, pending: 3, updatedAt: 1}}})
    assert.equal(shown.sent, 1, 'the content asks the worker by message')
    assert.equal(shown.bar, 1)
    assert.equal(shown.removed, 0)
    assert.equal(shown.width, '25%')
    assert.equal(shown.text, '1 / 4', 'the count reads terminal over total')
    const zeroOfTotal = await runContentRefresh({reply: {summary: {total: 4, pending: 4, updatedAt: 1}}})
    assert.equal(zeroOfTotal.bar, 1, 'queued work with nothing finished shows 0/total (decision 13)')
    assert.equal(zeroOfTotal.width, '0%')
})

test('the content bar is hidden when the request fails, the queue is paused, nothing is queued, or the batch is done', async () => {
    const failed = await runContentRefresh({reply: new Error('no receiver')})
    assert.equal(failed.removed, 1, 'a failed request hides the bar')
    assert.equal(failed.bar, 0)
    const paused = await runContentRefresh({reply: {summary: {total: 4, pending: 3, updatedAt: 1}}, paused: true})
    assert.equal(paused.removed, 1)
    const empty = await runContentRefresh({reply: {summary: {total: 0, pending: 0, updatedAt: 1}}})
    assert.equal(empty.removed, 1)
    const done = await runContentRefresh({reply: {summary: {total: 4, pending: 0, updatedAt: 1}}})
    assert.equal(done.removed, 1)
    const noSummary = await runContentRefresh({reply: {summary: null}})
    assert.equal(noSummary.removed, 1, 'no summary recorded yet hides the bar')
})

test('a pushed summary is used as given, without a second request to the worker', async () => {
    const pushed = await runContentRefresh({pushedSummary: {total: 5, pending: 2, updatedAt: 9}})
    assert.equal(pushed.sent, 0, 'a push is not answered by another request')
    assert.equal(pushed.bar, 1)
    assert.equal(pushed.width, '60%')
})

let failed = 0
;(async () => {
    for(const {name, fn} of tests) {
        try {
            await fn()
            console.log(`ok - ${name}`)
        }
        catch (error) {
            failed += 1
            console.log(`not ok - ${name}`)
            console.log(error?.stack || error)
        }
    }
    if(failed) {
        console.log(`${failed} queue bar summary test(s) failed`)
        process.exitCode = 1
    }
})()
