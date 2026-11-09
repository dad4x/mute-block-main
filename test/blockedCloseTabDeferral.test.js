// A blocked profile page keeps its Close tab button (owner, 8 Nov). The button waits only while the queue drives the tab: an action is
// claimed or running there, or a queue row for the profile is pending. These tests run shouldDeferBlockedCloseTab from shared/js/content.js
// against stubs for the page state.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

function extractFunction(source, signature) {
    const start = source.indexOf(signature)
    assert.notEqual(start, -1, `missing ${signature}`)
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

const source = readRepoFile('shared/js/content.js')

// state: {blocked, pendingClaim, action, pendingRow}. action is undefined (no claim yet), null (running) or an object (claimed).
function loadHarness({blocked = true, pendingClaim = false, action = undefined, pendingRow = false} = {}) {
    const context = {
        isProfileBlocked: () => blocked,
        autoProfileActionPending: pendingClaim,
        autoProfileAction: action,
        hasCurrentProfilePendingCoordinatorQueueItem: () => pendingRow
    }
    vm.createContext(context)
    vm.runInContext(extractFunction(source, 'function shouldDeferBlockedCloseTab(target)'), context, {filename: 'blocked-close-tab-harness.js'})
    return context
}

const afterStats = {type: 'after-stats', element: {}}
const beforeMenu = {type: 'before-menu', element: {}}

test('a blocked profile the user opened keeps its Close tab button', () => {
    const context = loadHarness({blocked: true})
    assert.equal(context.shouldDeferBlockedCloseTab(afterStats), false)
})

test('a blocked profile tab with a running queued action defers the button', () => {
    const context = loadHarness({blocked: true, pendingClaim: true, action: null})
    assert.equal(context.shouldDeferBlockedCloseTab(afterStats), true)
})

test('a blocked profile tab with a claimed queued action defers the button', () => {
    const context = loadHarness({blocked: true, action: {action: 'nuke'}})
    assert.equal(context.shouldDeferBlockedCloseTab(afterStats), true)
})

test('a blocked profile with a pending queue row defers the button', () => {
    const context = loadHarness({blocked: true, pendingRow: true})
    assert.equal(context.shouldDeferBlockedCloseTab(afterStats), true)
})

test('the menu placement is never deferred', () => {
    const context = loadHarness({blocked: true, pendingClaim: true, action: null, pendingRow: true})
    assert.equal(context.shouldDeferBlockedCloseTab(beforeMenu), false)
})

test('an unblocked profile is never deferred', () => {
    const context = loadHarness({blocked: false, pendingClaim: true, action: null, pendingRow: true})
    assert.equal(context.shouldDeferBlockedCloseTab(afterStats), false)
})
