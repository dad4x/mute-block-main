// The nuking drop-down belongs to the toolbar only. A post's own Nuking pill and its queue button never get it (owner, 1 Nov). These tests
// run syncNukingControlForButton from shared/js/content.js against stubs that record whether the drop-down was attached or removed.
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

function loadHarness(pageType = 'space') {
    const calls = []
    const context = {
        console,
        calls,
        pageType,
        getPageType: () => pageType,
        attachNukingControl: (button, left) => calls.push({op: 'attach', button: button.name, left}),
        detachNukingControl: button => calls.push({op: 'detach', button: button?.name || null})
    }
    vm.createContext(context)
    vm.runInContext([
        extractFunction(source, 'function nukingControlPageAllowed()'),
        extractFunction(source, 'function syncNukingControlForButton(button, label)')
    ].join('\n\n'), context, {filename: 'space-feed-post-button-no-dropdown-harness.js'})
    return context
}

function fakeButton(name, classes = []) {
    return {name, classList: {contains: cls => classes.includes(cls)}}
}

test('a post Nuking pill gets no drop-down while it reads Nuking', () => {
    const context = loadHarness()
    context.syncNukingControlForButton(fakeButton('post-pill', ['mb-ext_space-feed-post-nuke-btn']), 'Nuking this')
    assert.deepEqual(context.calls, [{op: 'detach', button: 'post-pill'}])
})

test('a post queue button gets no drop-down while it reads Nuking', () => {
    const context = loadHarness()
    context.syncNukingControlForButton(fakeButton('post-queue', ['mb-ext_space-feed-post-queue-btn']), 'Nuking...')
    assert.deepEqual(context.calls, [{op: 'detach', button: 'post-queue'}])
})

test('the toolbar Nuke button still gets the drop-down while it reads Nuking', () => {
    const context = loadHarness()
    context.syncNukingControlForButton(fakeButton('toolbar', ['mb-ext_space-feed-nuke-btn']), 'Nuking... 3 left')
    assert.deepEqual(context.calls, [{op: 'attach', button: 'toolbar', left: 0}])
})

test('a non-Nuking label removes the drop-down from any button', () => {
    const context = loadHarness()
    context.syncNukingControlForButton(fakeButton('toolbar', ['mb-ext_space-feed-nuke-btn']), 'Nuke \'Em 4')
    assert.deepEqual(context.calls, [{op: 'detach', button: 'toolbar'}])
})
