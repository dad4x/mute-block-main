const assert = require('node:assert/strict')
const {
    canTransitionJobStatus,
    getQueueItemExecutorTabAction,
    getJobMilestonesFromProgress,
    isRetryableJobFailure,
    isRetryableJobFailureFromProgress,
    makeJobDedupeKey,
    mapProgressToCoordinatorState,
    mapProgressToJobState,
    reduceJobEvent,
    JOB_EVENT_MILESTONE,
    JOB_EVENT_PAUSE,
    JOB_EVENT_RETRY,
    JOB_EVENT_TAB_REMOVED,
    JOB_EVENT_TERMINAL,
    upgradeCoordinatorQueueItem
} = require('../shared/js/jobState')

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

test('maps successful progress records to terminal succeeded jobs', () => {
    assert.deepEqual(mapProgressToJobState({
        status: 'already-blocked',
        blockSucceeded: true
    }), {
        status: 'succeeded',
        outcome: 'already-blocked',
        error: '',
        terminal: true
    })
})

test('maps explicit security verification as non-retryable failed state', () => {
    const mapped = mapProgressToJobState({
        status: 'error',
        securityVerification: true,
        securityVerificationReason: 'Verify you are human',
        finalError: 'Queued tab landed on a security verification page'
    })

    assert.deepEqual(mapped, {
        status: 'failed',
        outcome: 'security-verification',
        error: 'Queued tab landed on a security verification page',
        terminal: true
    })
    assert.equal(isRetryableJobFailure(mapped), false)
})

test('maps timeout-style interrupted progress as retryable failed state', () => {
    const mapped = mapProgressToJobState({
        status: 'interrupted',
        finalError: 'Queued tab timed out after disappearing before completion'
    })

    assert.equal(mapped.status, 'failed')
    assert.equal(mapped.outcome, 'timeout')
    assert.equal(isRetryableJobFailure(mapped), true)
})

test('maps browser error pages distinctly from generic action errors', () => {
    const mapped = mapProgressToJobState({
        status: 'error-page',
        errorPageUrl: 'chrome-error://chromewebdata/'
    })

    assert.equal(mapped.status, 'failed')
    assert.equal(mapped.outcome, 'error-page')
    assert.equal(mapped.terminal, true)
})

test('keeps coordinator display compatibility for active progress statuses', () => {
    assert.equal(mapProgressToJobState({status: 'tab-opening'}).status, 'opening')
    assert.equal(mapProgressToCoordinatorState({status: 'tab-opening'}).status, 'active')
    assert.equal(mapProgressToCoordinatorState({status: 'blocking'}).status, 'active')
    assert.equal(mapProgressToCoordinatorState({status: 'unblocking', actionKind: 'unblock-unmute'}).status, 'active')
})

test('maps reverse unblock-unmute progress to terminal success', () => {
    const mapped = mapProgressToCoordinatorState({
        actionKind: 'unblock-unmute',
        status: 'unblocked',
        unblockSucceeded: true
    })

    assert.equal(mapped.status, 'succeeded')
    assert.equal(mapped.outcome, 'unblocked')
    assert.equal(mapped.terminal, true)
})

test('maps reverse ok flags to terminal success when late status stays unblocking', () => {
    const mapped = mapProgressToCoordinatorState({
        actionKind: 'unblock-unmute',
        status: 'unblocking',
        unblockOk: true,
        unblockReason: 'unblocked',
        unmuteOk: true,
        unmuteReason: 'unmute-clicked-unverified'
    })

    assert.equal(mapped.status, 'succeeded')
    assert.equal(mapped.outcome, 'unblocked')
    assert.equal(mapped.terminal, true)
})

test('extracts durable milestones from legacy profile progress', () => {
    assert.deepEqual(getJobMilestonesFromProgress({
        tabCreatedAt: 10,
        tabOpenedAt: 20,
        contentOpenedAt: 30,
        actionReadyAt: 40,
        muteAttemptedAt: 50,
        blockAttemptedAt: 60,
        closeRequestedAt: 70,
        tabClosedAt: 80
    }), {
        tabCreatedAt: 10,
        navigationStartedAt: 20,
        contentOpenedAt: 30,
        actionClaimedAt: 30,
        profileReadyAt: 40,
        muteAttemptedAt: 50,
        blockAttemptedAt: 60,
        closeRequestedAt: 70,
        tabClosedAt: 80
    })
})

test('builds stable dedupe keys from scope, action, and canonical subject', () => {
    assert.equal(
        makeJobDedupeKey({
            scope: {runId: 'space-feed-1'},
            actionKind: 'mute-block',
            profileHref: 'https://www.quora.com/profile/Some-User/answers'
        }),
        'space-feed-1|mute-block|https://www.quora.com/profile/Some-User'
    )
})

test('upgrades v1 coordinator queue rows without changing physical key needs', () => {
    const upgraded = upgradeCoordinatorQueueItem('https://www.quora.com/profile/Some-User', {
        id: 'item-1',
        runId: 'run-1',
        dedupeKey: 'https://www.quora.com/profile/Some-User',
        status: 'queued',
        source: {
            type: 'space-feed',
            pageUrl: 'https://example.quora.com/',
            spaceKey: 'example',
            spaceCategory: 'asset'
        },
        tabId: 123,
        attempt: 2
    })

    assert.equal(upgraded.schemaVersion, 2)
    assert.equal(upgraded.actionKind, 'mute-block')
    assert.equal(upgraded.canonicalSubject.href, 'https://www.quora.com/profile/Some-User')
    assert.equal(upgraded.scope.runId, 'run-1')
    assert.equal(upgraded.attempt.number, 2)
    assert.equal(upgraded.attempt.claimedTabId, 123)
})

test('allows only explicit recovery transitions from terminal failures', () => {
    assert.equal(canTransitionJobStatus('failed', 'queued'), true)
    assert.equal(canTransitionJobStatus('succeeded', 'queued'), false)
    assert.equal(canTransitionJobStatus('queued', 'opening'), true)
    assert.equal(canTransitionJobStatus('queued', 'active'), true)
    assert.equal(canTransitionJobStatus('acting', 'canceled'), true)
    assert.equal(canTransitionJobStatus('settling', 'canceled'), true)
})

test('preserves reverse executor action when a fallback requests nuke', () => {
    assert.equal(getQueueItemExecutorTabAction({
        actionKind: 'unblock-unmute',
        executorTabAction: 'nuke'
    }, 'nuke'), 'unblock-unmute')
})

test('uses fallback executor action only when the item has no trusted action kind', () => {
    assert.equal(getQueueItemExecutorTabAction({}, 'unblock-unmute'), 'unblock-unmute')
    assert.equal(getQueueItemExecutorTabAction({}, 'nuke'), 'nuke')
})

test('reduces tab removal to terminal failed timeout for matching attempt', () => {
    const result = reduceJobEvent({
        status: 'active',
        attemptId: 'attempt-1',
        attemptNumber: 1,
        tabId: 42,
        milestones: {}
    }, {
        type: JOB_EVENT_TAB_REMOVED,
        attemptId: 'attempt-1',
        tabClosedAt: 1000,
        error: 'Queued tab timed out after disappearing before completion'
    })

    assert.equal(result.accepted, true)
    assert.equal(result.item.status, 'failed')
    assert.equal(result.item.outcome, 'timeout')
    assert.equal(result.item.error, 'Queued tab timed out after disappearing before completion')
    assert.equal(result.item.tabId, null)
    assert.equal(result.item.terminalAt, 1000)
    assert.equal(result.item.milestones.tabClosedAt, 1000)
})

test('rejects stale attempt events in the job reducer', () => {
    const result = reduceJobEvent({
        status: 'active',
        attemptId: 'attempt-2',
        tabId: 42
    }, {
        type: JOB_EVENT_TERMINAL,
        attemptId: 'attempt-1',
        status: 'succeeded',
        outcome: 'blocked'
    })

    assert.equal(result.accepted, false)
    assert.equal(result.reason, 'stale-attempt')
    assert.equal(result.item.status, 'active')
})

test('reduces legacy progress milestone from queued directly to active', () => {
    const result = reduceJobEvent({
        status: 'queued',
        attemptId: 'attempt-1',
        attemptNumber: 1
    }, {
        type: JOB_EVENT_MILESTONE,
        status: 'active',
        attemptId: 'attempt-1',
        tabId: 42,
        contentOpenedAt: 1000
    })

    assert.equal(result.accepted, true)
    assert.equal(result.item.status, 'active')
    assert.equal(result.item.tabId, 42)
    assert.equal(result.item.activeAt, result.item.updatedAt)
    assert.equal(result.item.milestones.contentOpenedAt, 1000)
})

test('milestone updates preserve existing values when progress patch is sparse', () => {
    const result = reduceJobEvent({
        status: 'active',
        attemptId: 'attempt-1',
        attemptNumber: 1,
        milestones: {
            contentOpenedAt: 1000,
            profileReadyAt: 1500,
            muteAttemptedAt: 2000
        }
    }, {
        type: JOB_EVENT_MILESTONE,
        status: 'acting',
        attemptId: 'attempt-1',
        at: 3000,
        milestones: getJobMilestonesFromProgress({
            blockAttemptedAt: 2500
        })
    })

    assert.equal(result.accepted, true)
    assert.equal(result.item.status, 'acting')
    assert.equal(result.item.milestones.contentOpenedAt, 1000)
    assert.equal(result.item.milestones.profileReadyAt, 1500)
    assert.equal(result.item.milestones.muteAttemptedAt, 2000)
    assert.equal(result.item.milestones.blockAttemptedAt, 2500)
})

test('terminal success does not imply the browser tab is closed', () => {
    const result = reduceJobEvent({
        status: 'acting',
        attemptId: 'attempt-1',
        attemptNumber: 1,
        tabId: 42,
        milestones: {
            tabClosedAt: 0
        }
    }, {
        type: JOB_EVENT_TERMINAL,
        status: 'succeeded',
        outcome: 'blocked',
        attemptId: 'attempt-1',
        at: 3000
    })

    assert.equal(result.accepted, true)
    assert.equal(result.item.status, 'succeeded')
    assert.equal(result.item.terminalAt, 3000)
    assert.equal(result.item.milestones.tabClosedAt, 0)
})

test('pause cancels acting and settling work through the reducer', () => {
    for(const status of ['acting', 'settling']) {
        const result = reduceJobEvent({
            status,
            attemptId: `attempt-${status}`,
            attemptNumber: 1,
            tabId: 42
        }, {
            type: JOB_EVENT_PAUSE,
            attemptId: `attempt-${status}`,
            at: 4000
        })

        assert.equal(result.accepted, true)
        assert.equal(result.item.status, 'canceled')
        assert.equal(result.item.outcome, 'paused')
        assert.equal(result.item.error, 'Paused by user')
        assert.equal(result.item.milestones.closeRequestedAt, 4000)
    }
})

test('reduces failed retry to queued with fresh attempt identity', () => {
    const result = reduceJobEvent({
        status: 'failed',
        outcome: 'timeout',
        error: 'old failure',
        attemptId: 'old-attempt',
        attemptNumber: 1,
        terminalAt: 900,
        tabId: 42
    }, {
        type: JOB_EVENT_RETRY,
        attemptId: 'new-attempt',
        attemptNumber: 2,
        at: 1000,
        retryCount: 1
    })

    assert.equal(result.accepted, true)
    assert.equal(result.item.status, 'queued')
    assert.equal(result.item.outcome, '')
    assert.equal(result.item.error, '')
    assert.equal(result.item.attemptId, 'new-attempt')
    assert.equal(result.item.attemptNumber, 2)
    assert.equal(result.item.terminalAt, 0)
    assert.equal(result.item.tabId, null)
})

test('retry rejects mismatched source attempt when supplied', () => {
    const result = reduceJobEvent({
        status: 'active',
        attemptId: 'live-attempt',
        attemptNumber: 2
    }, {
        type: JOB_EVENT_RETRY,
        sourceAttemptId: 'old-attempt',
        sourceAttemptNumber: 1,
        attemptId: 'new-attempt',
        attemptNumber: 3,
        at: 5000,
        retryCount: 2
    })

    assert.equal(result.accepted, false)
    assert.equal(result.reason, 'stale-retry-source-attempt')
    assert.equal(result.item.attemptId, 'live-attempt')
    assert.equal(result.item.attemptNumber, 2)
})

test('retry accepts matching source attempt and advances to fresh identity', () => {
    const result = reduceJobEvent({
        status: 'active',
        attemptId: 'live-attempt',
        attemptNumber: 2
    }, {
        type: JOB_EVENT_RETRY,
        sourceAttemptId: 'live-attempt',
        sourceAttemptNumber: 2,
        attemptId: 'new-attempt',
        attemptNumber: 3,
        at: 5000,
        retryCount: 2
    })

    assert.equal(result.accepted, true)
    assert.equal(result.item.status, 'queued')
    assert.equal(result.item.attemptId, 'new-attempt')
    assert.equal(result.item.attemptNumber, 3)
})

test('exhausted rollback recovery approves via the queueOnlyAuthority shortcut', () => {
    const result = reduceJobEvent({
        status: 'failed',
        attemptId: 'old-attempt',
        attemptNumber: 1,
        exhaustedRolledBackRecoveryCount: 2
    }, {
        type: JOB_EVENT_RETRY,
        attemptId: 'new-attempt',
        attemptNumber: 2,
        at: 1000,
        retryCount: 1,
        exhaustedRolledBackRecovery: {
            isExhausted: true,
            recoveryLimit: 3,
            queueOnlyAuthority: true
        }
    })

    assert.equal(result.accepted, true)
    assert.equal(result.item.status, 'queued')
    assert.equal(result.item.exhaustedRolledBackRecoveryCount, 3)
})

test('exhausted rollback recovery approves via the active-transition reason-match branch', () => {
    const result = reduceJobEvent({
        status: 'failed',
        attemptId: 'old-attempt',
        attemptNumber: 1,
        exhaustedRolledBackRecoveryCount: 2
    }, {
        type: JOB_EVENT_RETRY,
        attemptId: 'new-attempt',
        attemptNumber: 2,
        at: 1000,
        retryCount: 1,
        exhaustedRolledBackRecovery: {
            isExhausted: true,
            recoveryLimit: 3,
            recoverActiveTransitionFailures: true,
            activeTransitionRetry: true,
            queueAuthoritative: true,
            serviceWorkerOwned: true
        }
    })

    assert.equal(result.accepted, true)
    assert.equal(result.item.status, 'queued')
    assert.equal(result.item.exhaustedRolledBackRecoveryCount, 3)
})

test('exhausted rollback recovery approves a transient-open retry under queue-load pressure', () => {
    const result = reduceJobEvent({
        status: 'failed',
        attemptId: 'old-attempt',
        attemptNumber: 1,
        exhaustedRolledBackRecoveryCount: 2
    }, {
        type: JOB_EVENT_RETRY,
        attemptId: 'new-attempt',
        attemptNumber: 2,
        at: 1000,
        retryCount: 1,
        exhaustedRolledBackRecovery: {
            isExhausted: true,
            recoveryLimit: 3,
            recoverActiveTransitionFailures: true,
            transientOpenRetry: true,
            pressureOpenRetry: true,
            queueAuthoritative: true,
            serviceWorkerOwned: true
        }
    })

    assert.equal(result.accepted, true)
    assert.equal(result.item.status, 'queued')
    assert.equal(result.item.exhaustedRolledBackRecoveryCount, 3)
})

test('exhausted rollback recovery count cap rejects regardless of which branch would otherwise approve', () => {
    const result = reduceJobEvent({
        status: 'failed',
        attemptId: 'old-attempt',
        attemptNumber: 1,
        exhaustedRolledBackRecoveryCount: 3
    }, {
        type: JOB_EVENT_RETRY,
        attemptId: 'new-attempt',
        attemptNumber: 2,
        at: 1000,
        retryCount: 1,
        exhaustedRolledBackRecovery: {
            isExhausted: true,
            recoveryLimit: 3,
            queueOnlyAuthority: true
        }
    })

    assert.equal(result.accepted, false)
    assert.equal(result.reason, 'exhausted-rollback-recovery-denied')
    assert.equal(result.item.status, 'failed')
    assert.equal(result.item.exhaustedRolledBackRecoveryCount, 3)
})

test('classifies stale security-verification rows as retryable only with fresh transient progress', () => {
    assert.equal(isRetryableJobFailureFromProgress({
        status: 'failed',
        outcome: 'security-verification'
    }, {
        status: 'tab-opened'
    }), true)
    assert.equal(isRetryableJobFailureFromProgress({
        status: 'failed',
        outcome: 'security-verification'
    }, {
        status: 'error',
        securityVerification: true,
        finalError: 'Verify you are human'
    }), false)
})
