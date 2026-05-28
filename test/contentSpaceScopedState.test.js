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

function normalizeProfileHref(href = '') {
    const value = `${href || ''}`.split(/[?#]/)[0].replace(/\/+$/, '')
    return value.includes('/profile/') ? value : ''
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

function loadSpaceScopedStateHarness() {
    const source = readRepoFile('shared/js/content.js')
    const targetHref = 'https://www.quora.com/profile/Discovered-Target'
    const initialHref = 'https://www.quora.com/profile/Initial-Scope'
    const refreshCalls = []
    const renderSnapshots = []
    const context = {
        initialHref,
        targetHref,
        refreshCalls,
        renderSnapshots,
        console,
        normalizeProfileHref
    }
    vm.createContext(context)
    vm.runInContext([
        `let coordinatorQueueLoaded = true`,
        `let coordinatorQueue = {}`,
        `let profileNukeProgress = {}`,
        `let contentPageStateRefreshPromise = null`,
        `let spaceFeedScopedStateRefreshPromise = null`,
        `let spaceFeedScopedStateRefreshActiveSignature = ''`,
        `let spaceFeedScopedStateRefreshQueuedEntries = null`,
        `let spaceFeedScopedStateRefreshQueuedSignature = ''`,
        `let spaceFeedScopedStateSignature = initialHref`,
        `function getPageType() { return 'space' }`,
        `function getNormalizedProfileHrefList(hrefs = []) {
            const seen = new Set()
            const result = []
            for(const href of Array.isArray(hrefs) ? hrefs : []) {
                const normalized = normalizeProfileHref(href)
                if(!normalized || seen.has(normalized)) continue
                seen.add(normalized)
                result.push(normalized)
            }
            return result
        }`,
        `function getCurrentPageStateProfileHrefs(options = {}) {
            const hrefs = []
            for(const entry of Array.isArray(options.entries) ? options.entries : []) {
                hrefs.push(...(Array.isArray(entry.candidateUrls) ? entry.candidateUrls : []))
            }
            return getNormalizedProfileHrefList(hrefs).slice(0, 250)
        }`,
        `async function refreshContentPageCoordinatorStateFromRuntime(options = {}) {
            refreshCalls.push({
                force: options.force === true,
                entries: (options.entries || []).map(entry => ({
                    postKey: entry.postKey,
                    candidateUrls: [...(entry.candidateUrls || [])]
                }))
            })
            coordinatorQueue = {
                [targetHref]: {status: 'queued', targetProfileHref: targetHref}
            }
            profileNukeProgress = {
                [targetHref]: {status: 'queued', profileHref: targetHref}
            }
            coordinatorQueueLoaded = true
            return true
        }`,
        `function syncSpaceFeedNukeControls() {
            renderSnapshots.push({
                queueStatus: coordinatorQueue[targetHref]?.status || '',
                progressStatus: profileNukeProgress[targetHref]?.status || ''
            })
        }`,
        extractFunction(source, 'function getProfileHrefScopeSignature(profileHrefs = [])'),
        extractFunction(source, 'function getSpaceFeedScopedStateSignature(entries = [])'),
        extractFunction(source, 'function scheduleSpaceFeedScopedStateRefresh(entries = [])'),
        `globalThis.harness = {
            schedule: scheduleSpaceFeedScopedStateRefresh,
            pending: () => spaceFeedScopedStateRefreshPromise,
            signature: () => spaceFeedScopedStateSignature
        }`
    ].join('\n\n'), context, {filename: 'content-space-scoped-state-harness.js'})

    return {context, initialHref, targetHref, refreshCalls, renderSnapshots}
}

test('space feed discovery forces scoped runtime state refresh and rerender', async () => {
    const {context, initialHref, targetHref, refreshCalls, renderSnapshots} = loadSpaceScopedStateHarness()

    assert.equal(context.harness.signature(), initialHref)

    const scheduled = context.harness.schedule([{
        postKey: 'post-discovered',
        candidateUrls: [targetHref]
    }])
    assert.equal(scheduled, true)

    await context.harness.pending()

    assert.equal(refreshCalls.length, 1)
    assert.equal(refreshCalls[0].force, true)
    assert.equal(JSON.stringify(refreshCalls[0].entries), JSON.stringify([{
        postKey: 'post-discovered',
        candidateUrls: [targetHref]
    }]))
    assert.equal(context.harness.signature(), targetHref)
    assert.equal(JSON.stringify(renderSnapshots), JSON.stringify([{
        queueStatus: 'queued',
        progressStatus: 'queued'
    }]))
})
