const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

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

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

function extractFunction(source, signature) {
    const start = source.indexOf(signature)
    assert.notEqual(start, -1, `missing ${signature}`)

    const braceStart = source.indexOf('{', start + signature.length)
    assert.notEqual(braceStart, -1, `missing body for ${signature}`)

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

// Loads the real unmuteProfileBestEffort() from content.js and runs it against
// stubbed page helpers. `options.verified` decides whether the post-click
// check reports the inverse (unmuted) state.
function runUnmuteProfileBestEffort({menuState = 'normal', verified = true} = {}) {
    const source = readRepoFile('shared/js/content.js')
    const body = extractFunction(source, 'async function unmuteProfileBestEffort(options = {})')
    const unmuteButton = {label: 'Unmute'}

    const context = {
        console,
        getPageType: () => 'profile',
        getProfileMenuButton: () => ({}),
        waitForCondition: async () => true,
        ensureProfileMenuOpen: async () => true,
        sleep: async () => {},
        waitForMenuStateWithForegroundFallback: async () => ({
            state: menuState,
            button: menuState === 'normal' ? unmuteButton : null
        }),
        isUnmuteActionLabel: () => true,
        isMuteActionLabel: () => false,
        closeProfileMenu: async () => {},
        getMenuAction: () => null,
        activateActionElement: () => {},
        waitForAction: async () => null,
        getUnmuteConfirmAction: () => null,
        activateConfirmationElement: async () => {},
        isUnmuteConfirmPending: () => false,
        waitForProfileMenuState: async () => verified,
        dismissProfileActionSurface: async () => {},
        reportActionIssue: () => {}
    }

    vm.createContext(context)
    vm.runInContext(`${body}\nglobalThis.unmuteProfileBestEffort = unmuteProfileBestEffort`, context, {
        filename: 'content-unmute-verification-harness.js'
    })
    return context.unmuteProfileBestEffort({silent: true})
}

const cases = []
function register(name, fn) {
    cases.push([name, fn])
}
register('verified unmute reports ok with reason unmuted', async () => {
    const result = await runUnmuteProfileBestEffort({menuState: 'normal', verified: true})

    assert.equal(result.ok, true)
    assert.equal(result.reason, 'unmuted')
})

register('already-unmuted profile reports ok without a click', async () => {
    const result = await runUnmuteProfileBestEffort({menuState: 'inverse'})

    assert.equal(result.ok, true)
    assert.equal(result.reason, 'already-unmuted')
    assert.equal(result.changed, false)
})

register('unverified unmute click does not report ok', async () => {
    const result = await runUnmuteProfileBestEffort({menuState: 'normal', verified: false})

    assert.equal(result.ok, false)
    assert.equal(result.reason, 'unmute-clicked-unverified')
    assert.equal(result.changed, true)
})

register('blocked unblock path refuses success when the unmute is unverified', async () => {
    const source = readRepoFile('shared/js/content.js')
    const body = extractFunction(source, 'async function unblockUnmuteProfile(options = {})')
    const guard = body.indexOf("unmute?.reason === 'unmute-clicked-unverified'")
    const clear = body.indexOf('await clearProfileNukeState(profileHref, ')
    assert.notEqual(guard, -1, 'unverified-unmute guard missing')
    assert.ok(guard < clear, 'guard must run before nuke state is cleared')
    assert.match(body.slice(guard, clear), /return {ok: false, reason: unmute.reason/)
})

;(async () => {
    for(const [name, fn] of cases) await test(name, fn)
})().catch(() => { process.exitCode = 1 })
