// The worker's progress push (decision 31, D13 b): which tabs it is sent to, what it sends, and what a failed send does. The module
// takes the tabs API as a dependency, so no service worker or browser is needed here.
const assert = require('node:assert/strict')
const {
    PROFILE_NUKE_PROGRESS_PUSH_ACTION,
    PROFILE_NUKE_PROGRESS_GET_ACTION,
    createProfileNukeProgressPush
} = require('../shared/js/swProfileNukeProgressPush')

const tests = []
function test(name, fn) {
    tests.push({name, fn})
}

// Lets the promise chains of push() settle, so a failed send has removed its tab before the test looks.
function settle() {
    return new Promise(resolve => setImmediate(resolve))
}

function makeTabs({rejectTabIds = [], throwTabIds = []} = {}) {
    const sent = []
    return {
        sent,
        tabs: {
            sendMessage(tabId, message) {
                if(throwTabIds.includes(tabId)) throw new Error('throws at once')
                sent.push({tabId, message})
                if(rejectTabIds.includes(tabId)) return Promise.reject(new Error('Receiving end does not exist'))
                return Promise.resolve(undefined)
            }
        }
    }
}

test('the push and get actions have the names the content script and the tools use', () => {
    assert.equal(PROFILE_NUKE_PROGRESS_PUSH_ACTION, 'profile-nuke-progress-changed')
    assert.equal(PROFILE_NUKE_PROGRESS_GET_ACTION, 'get-profile-nuke-progress')
})

test('only whole, non-negative tab ids are subscribed, and a repeat subscribe adds nothing', () => {
    const push = createProfileNukeProgressPush({getTabs: () => makeTabs().tabs})
    push.subscribe(7)
    push.subscribe('8')
    push.subscribe(undefined)
    push.subscribe(null)
    push.subscribe(-1)
    push.subscribe('x')
    push.subscribe(7)
    assert.equal(push.size(), 2)
})

test('a push sends the action, and no data, to every subscribed tab, and reports how many it sent to', async () => {
    const fake = makeTabs()
    const push = createProfileNukeProgressPush({getTabs: () => fake.tabs})
    push.subscribe(3)
    push.subscribe(4)
    assert.equal(push.push(), 2)
    await settle()
    assert.deepEqual(fake.sent, [
        {tabId: 3, message: {action: PROFILE_NUKE_PROGRESS_PUSH_ACTION}},
        {tabId: 4, message: {action: PROFILE_NUKE_PROGRESS_PUSH_ACTION}}
    ])
})

test('a push with no subscribed tab sends nothing and reads no tabs', async () => {
    let reads = 0
    const push = createProfileNukeProgressPush({getTabs: () => {
        reads += 1
        return makeTabs().tabs
    }})
    assert.equal(push.push(), 0)
    await settle()
    assert.equal(reads, 0)
})

test('a tab whose send rejects is dropped, and the other tabs keep their subscription', async () => {
    const fake = makeTabs({rejectTabIds: [5]})
    const push = createProfileNukeProgressPush({getTabs: () => fake.tabs})
    push.subscribe(5)
    push.subscribe(6)
    push.push()
    await settle()
    assert.equal(push.size(), 1)
    push.push()
    await settle()
    assert.deepEqual(fake.sent.map(entry => entry.tabId), [5, 6, 6])
})

test('a send that throws at once also drops its tab, without stopping the push to the other tabs', async () => {
    const fake = makeTabs({throwTabIds: [9]})
    const push = createProfileNukeProgressPush({getTabs: () => fake.tabs})
    push.subscribe(9)
    push.subscribe(10)
    push.push()
    await settle()
    assert.equal(push.size(), 1)
    assert.deepEqual(fake.sent.map(entry => entry.tabId), [10])
})

test('the tabs API is read when a push runs, so creating the module needs no browser', async () => {
    let reads = 0
    const push = createProfileNukeProgressPush({getTabs: () => {
        reads += 1
        return makeTabs().tabs
    }})
    push.subscribe(1)
    push.push()
    await settle()
    assert.equal(reads, 1)
})

test('a late failed send does not drop a tab that asked again after the send started (20 Oct review)', async () => {
    const pending = []
    const tabs = {
        sendMessage(tabId) {
            return new Promise((resolve, reject) => pending.push({resolve, reject, tabId}))
        }
    }
    const push = createProfileNukeProgressPush({getTabs: () => tabs})
    push.subscribe(5)
    push.push()
    await settle()
    assert.equal(pending.length, 1, 'the send is still in flight')

    push.subscribe(5)
    pending[0].reject(new Error('Receiving end does not exist'))
    await settle()
    assert.equal(push.size(), 1, 'the subscription made after the send started survives its failure')
})

test('a failed send drops its tab when the tab has not asked again since the send (the earlier rule still holds)', async () => {
    const pending = []
    const tabs = {
        sendMessage() {
            return new Promise((resolve, reject) => pending.push({resolve, reject}))
        }
    }
    const push = createProfileNukeProgressPush({getTabs: () => tabs})
    push.subscribe(6)
    push.push()
    await settle()
    pending[0].reject(new Error('Receiving end does not exist'))
    await settle()
    assert.equal(push.size(), 0)
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
        console.log(`${failed} progress push test(s) failed`)
        process.exitCode = 1
    }
})()
