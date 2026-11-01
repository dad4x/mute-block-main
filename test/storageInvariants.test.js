const assert = require('node:assert/strict')
const {
    COORDINATOR_QUEUE_KEY,
    COORDINATOR_RUNS_KEY,
    checkStorageInvariants
} = require('./lib/storageInvariants')

function test(name, fn) {
    try {
        fn()
        console.log(`ok - ${name}`)
    }
    catch(error) {
        console.error(`not ok - ${name}`)
        throw error
    }
}

function profile(slug) {
    return `https://www.quora.com/profile/${slug}`
}

function cleanSnapshot() {
    const first = profile('Queued-User')
    const second = profile('Active-User')
    const third = profile('Done-User')
    const runId = 'run-storage-clean'

    return {
        [COORDINATOR_QUEUE_KEY]: {
            [first]: {
                runId,
                status: 'queued',
                targetProfileHref: first
            },
            [second]: {
                runId,
                status: 'active',
                targetProfileHref: second,
                attemptId: 'attempt-active',
                tabId: 42,
                actionLease: {
                    tabId: 42,
                    attemptId: 'attempt-active',
                    expiresAt: 2000
                }
            },
            [third]: {
                runId,
                status: 'succeeded',
                targetProfileHref: third,
                attemptId: 'attempt-done',
                tabId: null,
                actionLease: null
            }
        },
        [COORDINATOR_RUNS_KEY]: {
            [runId]: {
                id: runId,
                status: 'active',
                targetProfileHrefs: [first, second, third]
            }
        },
    }
}

function issueCodes(issues) {
    return issues.map(issue => issue.code)
}

test('passes clean queued active and terminal snapshot', () => {
    assert.deepEqual(checkStorageInvariants(cleanSnapshot()), [])
})

test('flags terminal queue rows retaining tab or lease ownership', () => {
    const href = profile('Leaky-Terminal')
    const issues = checkStorageInvariants({
        [COORDINATOR_QUEUE_KEY]: {
            [href]: {
                runId: 'run-leaky',
                status: 'succeeded',
                targetProfileHref: href,
                tabId: 12,
                actionLease: {
                    tabId: 12,
                    attemptId: 'attempt-old'
                }
            }
        }
    })

    assert.deepEqual(issueCodes(issues), [
        'terminal-queue-active-field',
        'terminal-queue-active-field'
    ])
    assert.deepEqual(issues.map(issue => issue.field), ['tabId', 'actionLease'])
    assert.equal(issues[0].key, href)
    assert.equal(issues[0].status, 'succeeded')
})

test('flags active queue rows without attempt identity', () => {
    const href = profile('Attemptless-Active')
    const issues = checkStorageInvariants({
        [COORDINATOR_QUEUE_KEY]: {
            [href]: {
                status: 'acting',
                targetProfileHref: href,
                tabId: 44
            }
        }
    })

    assert.deepEqual(issueCodes(issues), ['active-queue-missing-attempt'])
    assert.equal(issues[0].key, href)
    assert.equal(issues[0].status, 'acting')
})





test('warns when an active run target has no queue row', () => {
    const href = profile('Missing-From-Queue')
    const issues = checkStorageInvariants({
        [COORDINATOR_RUNS_KEY]: {
            'run-missing': {
                id: 'run-missing',
                status: 'active',
                targetProfileHrefs: [href]
            }
        }
    })

    assert.deepEqual(issueCodes(issues), ['run-target-missing-queue'])
    assert.equal(issues[0].severity, 'warning')
    assert.equal(issues[0].runId, 'run-missing')
    assert.equal(issues[0].href, href)
})
