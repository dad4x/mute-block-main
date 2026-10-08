const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const tests = []

function asyncTest(name, fn) {
    tests.push({name, fn})
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

// Loads the real sendCoordinatorEnqueueChunked (and its direct helper
// waitForCoordinatorEnqueueSummary, in case a test wants it to actually
// fire) out of shared/js/content.js into a vm context with fake
// chrome-message/timeout/sleep primitives, so this proves the real retry
// loop's behavior rather than re-implementing it in a mock.
function loadChunkedEnqueueHarness({
    chunkSize = 2,
    maxAttempts = 3,
    sendRuntimeMessage,
    sleepCalls = []
} = {}) {
    const source = readRepoFile('shared/js/content.js')
    const context = {
        COORDINATOR_ENQUEUE_CHUNK_SIZE: chunkSize,
        SPACE_FEED_ENQUEUE_MESSAGE_TIMEOUT_MS: 15000,
        SPACE_FEED_ENQUEUE_SUMMARY_POLL_TIMEOUT_MS: 90000,
        SPACE_FEED_ENQUEUE_SUMMARY_POLL_INTERVAL_MS: 1000,
        SPACE_FEED_ENQUEUE_CHUNK_MAX_ATTEMPTS: maxAttempts,
        SPACE_FEED_ENQUEUE_CHUNK_RETRY_BASE_DELAY_MS: 1,
        safeSendRuntimeMessageWithTimeout: sendRuntimeMessage,
        safeStorageGet: async () => ({}),
        COORDINATOR_LAST_ENQUEUE_SUMMARY_KEY: 'mbCoordinatorLastEnqueueSummary',
        sleep: async (ms) => { sleepCalls.push(ms) }
    }
    vm.createContext(context)
    vm.runInContext(
        extractFunction(source, 'async function waitForCoordinatorEnqueueSummary(runId, timeoutMs, intervalMs = SPACE_FEED_ENQUEUE_SUMMARY_POLL_INTERVAL_MS)'),
        context,
        {filename: 'content-enqueue-chunk-retry-harness.js'}
    )
    vm.runInContext(
        extractFunction(source, 'async function sendCoordinatorEnqueueChunked(payload = {}, onProgress = null)'),
        context,
        {filename: 'content-enqueue-chunk-retry-harness.js'}
    )

    return {
        run(payload, onProgress) {
            context.__payload = payload
            context.__onProgress = onProgress || null
            return vm.runInContext('sendCoordinatorEnqueueChunked(__payload, __onProgress)', context)
        }
    }
}

asyncTest('a chunk that fails once recovers on retry instead of abandoning later chunks', async () => {
    // 4 items split into 2 chunks of 2 (see chunkSize below). The first
    // chunk succeeds immediately; the second chunk fails its first attempt
    // (durable: false, as a stalled WAL write would report) then succeeds on
    // retry. Before the fix this would have stopped after chunk 1, reporting
    // only 2 of 4 items queued with no indication the user needs to do
    // anything -- the exact "math doesn't add up" shape reported live
    // 2026-10-03 against a 491-candidate batch that silently dropped its
    // last 32-item chunk.
    const attemptsByChunk = new Map()
    const sendRuntimeMessage = async (message) => {
        const key = JSON.stringify(message.items)
        const attempt = (attemptsByChunk.get(key) || 0) + 1
        attemptsByChunk.set(key, attempt)

        if(message.items[0] === 3 && attempt === 1) {
            return {queued: 0, merged: 0, durable: false, reason: 'simulated-transient-failure'}
        }
        return {queued: message.items.length, merged: 0, durable: true}
    }

    const sleepCalls = []
    const harness = loadChunkedEnqueueHarness({chunkSize: 2, maxAttempts: 3, sendRuntimeMessage, sleepCalls})
    const progressCalls = []
    const result = await harness.run(
        {run: {id: 'run-retry-recovers'}, source: {type: 'space-feed'}, execute: null, items: [1, 2, 3, 4]},
        (queued, merged, total) => progressCalls.push([queued, merged, total])
    )

    assert.equal(result.queued, 4, 'both chunks should have landed once the failing one was retried')
    assert.equal(result.durable, true)
    assert.equal(result.reason, undefined, 'a recovered chunk must not be reported as a failure')
    assert.equal(attemptsByChunk.get(JSON.stringify([3, 4])), 2, 'the failing chunk should have been retried, not skipped')
    assert.ok(sleepCalls.length >= 1, 'a retry should back off before resending')
    assert.deepEqual(progressCalls[progressCalls.length - 1], [4, 0, 4])
})

asyncTest('a chunk that never recovers is still truthfully reported as incomplete', async () => {
    // Exhausts every retry attempt on the second chunk, proving the fix
    // doesn't paper over a genuinely unrecoverable failure -- the user's
    // requirement was that the mechanism itself be reliable, not that
    // failure be silently pretended away.
    const sendRuntimeMessage = async (message) => {
        if(message.items[0] === 3) {
            return {queued: 0, merged: 0, durable: false, reason: 'persistently-failing'}
        }
        return {queued: message.items.length, merged: 0, durable: true}
    }

    const harness = loadChunkedEnqueueHarness({chunkSize: 2, maxAttempts: 3, sendRuntimeMessage})
    const result = await harness.run({
        run: {id: 'run-retry-exhausted'}, source: {type: 'space-feed'}, execute: null, items: [1, 2, 3, 4]
    })

    assert.equal(result.queued, 2, 'only the first chunk should have landed')
    assert.equal(result.reason, 'persistently-failing')
})

;(async () => {
    let failed = 0
    for(const {name, fn} of tests) {
        try {
            await fn()
            console.log(`ok - ${name}`)
        }
        catch(error) {
            failed += 1
            console.error(`not ok - ${name}`)
            console.error(error)
        }
    }
    if(failed) {
        console.error(`${failed}/${tests.length} contentEnqueueChunkRetry tests failed`)
        process.exitCode = 1
    }
})()
