const assert = require('node:assert/strict')
const {
    COORDINATOR_QUEUE_KEY,
    COORDINATOR_RUNS_KEY,
    SPACE_PENDING_POSTS_KEY,
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
        [SPACE_PENDING_POSTS_KEY]: {
            'post-clean': {
                postKey: 'post-clean',
                remainingUrls: [first, second],
                jobKeysByProfileHref: {
                    [first]: first,
                    [second]: second
                },
                resolverPending: false
            }
        }
    }
}

function issueCodes(issues) {
    return issues.map(issue => issue.code)
}

test('passes clean queued active terminal and pending-post snapshot', () => {
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

test('flags pending post URL whose queue row is terminal', () => {
    const href = profile('Already-Settled')
    const issues = checkStorageInvariants({
        [COORDINATOR_QUEUE_KEY]: {
            [href]: {
                status: 'skipped',
                targetProfileHref: href,
                attemptId: 'attempt-skipped'
            }
        },
        [SPACE_PENDING_POSTS_KEY]: {
            'post-terminal': {
                remainingUrls: [href],
                jobKeysByProfileHref: {
                    [href]: href
                }
            }
        }
    })

    assert.deepEqual(issueCodes(issues), ['terminal-url-still-pending'])
    assert.equal(issues[0].postKey, 'post-terminal')
    assert.equal(issues[0].href, href)
    assert.equal(issues[0].key, href)
    assert.equal(issues[0].status, 'skipped')
})

test('flags missing and stale pending post job-key mappings', () => {
    const remaining = profile('Still-Queued')
    const stale = profile('No-Longer-Remaining')
    const issues = checkStorageInvariants({
        [COORDINATOR_QUEUE_KEY]: {
            [remaining]: {
                status: 'queued',
                targetProfileHref: remaining
            }
        },
        [SPACE_PENDING_POSTS_KEY]: {
            'post-mapping': {
                remainingUrls: [remaining],
                jobKeysByProfileHref: {
                    [stale]: stale
                }
            }
        }
    })

    assert.deepEqual(issueCodes(issues), [
        'pending-job-key-missing',
        'pending-job-key-stale'
    ])
    assert.equal(issues[0].postKey, 'post-mapping')
    assert.equal(issues[0].href, remaining)
    assert.equal(issues[1].href, stale)
})

test('flags resolver-pending records without resolver URL evidence', () => {
    const issues = checkStorageInvariants({
        [SPACE_PENDING_POSTS_KEY]: {
            'post-unresolved': {
                resolverPending: true,
                remainingUrls: [],
                jobKeysByProfileHref: {}
            }
        }
    })

    assert.deepEqual(issueCodes(issues), ['resolver-pending-missing-url'])
    assert.equal(issues[0].postKey, 'post-unresolved')
})

test('flags resolver-pending records after terminal resolver queue row', () => {
    const resolverUrl = 'https://www.quora.com/q/example/post/abc'
    const resolverKey = `resolve-profile:${resolverUrl}`
    const issues = checkStorageInvariants({
        [COORDINATOR_QUEUE_KEY]: {
            [resolverKey]: {
                status: 'failed',
                requestedUrl: resolverUrl,
                resolutionMode: 'author-profile',
                resolveProfileFromPage: true,
                attemptId: 'attempt-resolver'
            }
        },
        [SPACE_PENDING_POSTS_KEY]: {
            'post-resolver': {
                resolverPending: true,
                resolverUrl,
                remainingUrls: [],
                jobKeysByProfileHref: {}
            }
        }
    })

    assert.deepEqual(issueCodes(issues), ['terminal-resolver-still-pending'])
    assert.equal(issues[0].postKey, 'post-resolver')
    assert.equal(issues[0].key, resolverKey)
    assert.equal(issues[0].resolverUrl, resolverUrl)
    assert.equal(issues[0].status, 'failed')
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
