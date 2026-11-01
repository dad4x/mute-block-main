const assert = require('node:assert/strict')
const {
    createFakeBrowser,
    loadServiceWorkerHarness
} = require('./lib/swHarness')

// Job-completion terminal-tab cleanup is scoped to the completed job's hrefs.
// The unscoped orphan sweep runs from the reconcile tick, throttled.

const tests = []
const ROOT = 'https://www.quora.com/profile/'
const NOW = 900000
const RUN_ID = 'run-terminal-owned-scope'

function test(name, fn) {
    tests.push({name, fn})
}

async function settle() {
    for(let index = 0; index < 300; index += 1) {
        await new Promise(resolve => setImmediate(resolve))
    }
}

function makeTerminalRow(href, extra = {}) {
    return {
        runId: RUN_ID,
        status: 'succeeded',
        actionKind: 'mute-block',
        executorTabAction: 'nuke',
        executorOwner: 'service-worker',
        serviceWorkerOwned: true,
        executorNoForegroundFallback: true,
        executorMaxConcurrent: 1,
        targetProfileHref: href,
        requestedUrl: href,
        dedupeKey: href,
        coordinatorKey: href,
        queuedAt: NOW - 5000,
        updatedAt: NOW - 1000,
        terminalAt: NOW - 1000,
        attemptId: `attempt-${href}`,
        attemptNumber: 1,
        milestones: {},
        ...extra
    }
}

function counterDelta(before, after, name) {
    return (after[name] || 0) - (before[name] || 0)
}

// Registers owned tabs before any terminal row exists, so no cleanup pass runs
// during setup. Rows are then inserted as terminal directly into the resident
// authority state.
async function setupScenario({ownedTabs = [], terminalRows = []}) {
    const browser = createFakeBrowser({})
    const {sw} = loadServiceWorkerHarness({now: NOW, browser, storage: {}})
    await sw.coordinatorAuthority.hydrate()

    for(const {tabId, href} of ownedTabs) {
        browser.__tabs.set(tabId, {id: tabId, url: href, windowId: 1, active: false})
        sw.__testAddProvisionalQueuedTab(tabId, {
            profileHref: href,
            coordinatorKey: href,
            requestedUrl: href,
            runId: RUN_ID,
            attemptId: `attempt-${href}`,
            attemptNumber: 1,
            tabAction: 'nuke',
            actionKind: 'mute-block'
        })
    }
    await settle()

    const queue = sw.coordinatorAuthority.current().queue
    for(const {href, tabId = null} of terminalRows) {
        queue[href] = makeTerminalRow(href, tabId ? {tabId} : {})
    }

    const getCalls = []
    const originalGet = browser.tabs.get
    browser.tabs.get = async tabId => {
        getCalls.push(Number(tabId))
        return originalGet(tabId)
    }
    return {browser, sw, getCalls}
}

test('completion for href A does not walk or close owned tabs for href B', async () => {
    const hrefA = `${ROOT}Scope-Completed-A`
    const hrefB = `${ROOT}Scope-Other-B`
    const tabB = 2002
    const {browser, sw, getCalls} = await setupScenario({
        ownedTabs: [{tabId: tabB, href: hrefB}],
        terminalRows: [{href: hrefA}, {href: hrefB}]
    })

    const before = sw.state().queueWakeupCounters
    const result = await sw.closeTerminalOwnedProfileTabs([hrefA], {completedJob: true})
    const after = sw.state().queueWakeupCounters

    assert.equal(result.ownedClosed, 0, 'A has no owned tab, so nothing is closed')
    assert.equal(getCalls.includes(tabB), false, 'B\'s owned tab is never fetched by A\'s completion pass')
    assert.equal(browser.__tabs.has(tabB), true, 'B\'s owned tab stays open')
    assert.equal(counterDelta(before, after, 'terminalOwnedTabClose.rowsScanned'), 1, 'only A\'s row is examined')
    assert.equal(counterDelta(before, after, 'terminalOwnedTabClose.ownedTabsWalked'), 0, 'no owned tab is walked')
    assert.equal(counterDelta(before, after, 'terminalOwnedTabClose.ownedTabsSkipped'), 1, 'B\'s owned tab is skipped by its recorded href')
})

test('completion for href A closes A\'s own owned tab and walks no other owned tab', async () => {
    const hrefA = `${ROOT}Scope-Completed-Own-A`
    const hrefB = `${ROOT}Scope-Other-Own-B`
    const tabA = 2101
    const tabB = 2102
    const {browser, sw} = await setupScenario({
        ownedTabs: [{tabId: tabA, href: hrefA}, {tabId: tabB, href: hrefB}],
        terminalRows: [{href: hrefA, tabId: tabA}, {href: hrefB}]
    })

    const before = sw.state().queueWakeupCounters
    const result = await sw.closeTerminalOwnedProfileTabs([hrefA], {completedJob: true})
    const after = sw.state().queueWakeupCounters

    assert.equal(result.ownedClosed, 1, 'A\'s owned tab is closed')
    assert.equal(browser.__tabs.has(tabA), false, 'A\'s owned tab is removed')
    assert.equal(counterDelta(before, after, 'terminalOwnedTabClose.ownedTabsWalked'), 0, 'A\'s tab was closed in the row pass, so the owned walk fetches nothing')
    // A's tab is removed before its release now, so the owned walk also finds it gone and skips it (no fetch). B's tab is skipped too.
    assert.equal(counterDelta(before, after, 'terminalOwnedTabClose.ownedTabsSkipped'), 2, 'A\'s and B\'s owned tabs are both skipped without a fetch')
})

test('orphan sweep closes a live tab that has no owner', async () => {
    const hrefC = `${ROOT}Scope-Orphan-C`
    const tabC = 2201
    const browser = createFakeBrowser({})
    const {sw} = loadServiceWorkerHarness({now: NOW, browser, storage: {}})
    await sw.coordinatorAuthority.hydrate()
    browser.__tabs.set(tabC, {id: tabC, url: hrefC, windowId: 1, active: false})
    // The queue made this tab, and its owner record is gone (the leftover case the sweep exists for).
    sw.__testRecordQueueCreatedWorkerTab(tabC)
    sw.coordinatorAuthority.current().queue[hrefC] = makeTerminalRow(hrefC)

    const result = await sw.closeTerminalOwnedProfileTabs()

    assert.equal(browser.__tabs.has(tabC), false, 'the unowned live tab for a terminal href is closed by the unscoped pass')
    assert.ok(result.liveTabsSignaled >= 1, 'the live-href sweep reports the signaled tab')
})

test('orphan sweep leaves a live tab the user opened on a terminal href', async () => {
    const hrefU = `${ROOT}Scope-Orphan-User`
    const tabU = 2202
    const browser = createFakeBrowser({})
    const {sw} = loadServiceWorkerHarness({now: NOW, browser, storage: {}})
    await sw.coordinatorAuthority.hydrate()
    browser.__tabs.set(tabU, {id: tabU, url: hrefU, windowId: 1, active: false, userTab: true})
    sw.coordinatorAuthority.current().queue[hrefU] = makeTerminalRow(hrefU)

    await sw.closeTerminalOwnedProfileTabs()

    assert.equal(browser.__tabs.has(tabU), true, 'a tab the queue did not make is not closed, even on a terminal href')
})

test('orphan sweep is throttled to one pass per interval', async () => {
    const browser = createFakeBrowser({})
    const {sw} = loadServiceWorkerHarness({now: NOW, browser, storage: {}})
    await sw.coordinatorAuthority.hydrate()

    const start = 1000
    const counters = () => sw.state().queueWakeupCounters
    const first = sw.scheduleTerminalOwnedTabOrphanSweep(start)
    const throttled = sw.scheduleTerminalOwnedTabOrphanSweep(start + 59999)
    const second = sw.scheduleTerminalOwnedTabOrphanSweep(start + 60000)
    await settle()

    assert.equal(first, true, 'the first call starts a sweep')
    assert.equal(throttled, false, 'a call inside the interval is throttled')
    assert.equal(second, true, 'a call at the interval boundary starts another sweep')
    assert.equal(counters()['terminalOwnedTabClose.orphanSweep'], 2)
    assert.equal(counters()['terminalOwnedTabClose.orphanSweepThrottled'], 1)
})

test('reconcile tick runs the orphan sweep on its cadence', async () => {
    const browser = createFakeBrowser({})
    const {sw} = loadServiceWorkerHarness({now: NOW, browser, storage: {}})
    await sw.coordinatorAuthority.hydrate()

    await sw.runCoordinatorReconcileTick('terminal-owned-orphan-sweep-test', {allowBeforeQuora: true})

    assert.ok((sw.state().queueWakeupCounters['terminalOwnedTabClose.orphanSweep'] || 0) >= 1, 'a reconcile tick starts the orphan sweep')
})

// Async tests run one after another; a failure rethrows, so the process exits non-zero.
;(async () => {
    for(const {name, fn} of tests) {
        try {
            await fn()
            console.log(`ok - ${name}`)
        }
        catch (error) {
            console.error(`not ok - ${name}`)
            throw error
        }
    }
})()
