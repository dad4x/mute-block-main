const {
    QUEUE_MACHINE_EVENT_TYPES,
    normalizeQueueMachineEventType
} = require('./swQueueMachineEvents')

function requireQueueMachineCapability(groupName = '', capabilities = {}, name = '') {
    const capability = capabilities?.[name]
    if(typeof capability !== 'function') {
        throw new Error(`Missing queue-machine ${groupName} capability: ${name}`)
    }
    return capability
}

function createCoordinatorQueueMachineEventHandlers(capabilities = {}) {
    const {
        constants = {},
        authority = {},
        durable = {},
        projection = {},
        runtime = {}
    } = capabilities
    const {
        QUEUE_CRITICAL_STORAGE_UPDATE_TIMEOUT_MS,
        SERVICE_WORKER_QUEUE_OWNER_ID
    } = constants
    const getHydratedCoordinatorAuthorityState = requireQueueMachineCapability('authority', authority, 'getHydratedCoordinatorAuthorityState')
    const isActiveCoordinatorStatus = requireQueueMachineCapability('authority', authority, 'isActiveCoordinatorStatus')
    const isCoordinatorActionLeaseExpired = requireQueueMachineCapability('authority', authority, 'isCoordinatorActionLeaseExpired')
    const isQueuedTabAttemptBudgetExhausted = requireQueueMachineCapability('authority', authority, 'isQueuedTabAttemptBudgetExhausted')
    const normalizeCoordinatorActionLease = requireQueueMachineCapability('authority', authority, 'normalizeCoordinatorActionLease')
    const normalizeCoordinatorAuthorityStateInput = requireQueueMachineCapability('authority', authority, 'normalizeCoordinatorAuthorityStateInput')
    const applyCoordinatorRowEvents = requireQueueMachineCapability('durable', durable, 'applyCoordinatorRowEvents')
    const clearProfileNukeState = requireQueueMachineCapability('durable', durable, 'clearProfileNukeState')
    const enqueueCoordinatorItemsStorageLocked = requireQueueMachineCapability('durable', durable, 'enqueueCoordinatorItemsStorageLocked')
    const markQueuedProfileResolutionUnresolved = requireQueueMachineCapability('durable', durable, 'markQueuedProfileResolutionUnresolved')
    const confirmSpaceFeedProfilesBlocked = requireQueueMachineCapability('durable', durable, 'confirmSpaceFeedProfilesBlocked')
    const mutateCoordinatorQueuedTabActiveTransition = requireQueueMachineCapability('durable', durable, 'mutateCoordinatorQueuedTabActiveTransition')
    const mutateCoordinatorQueuedTabOpenRollback = requireQueueMachineCapability('durable', durable, 'mutateCoordinatorQueuedTabOpenRollback')
    const mutateCoordinatorActionLeaseHeartbeat = requireQueueMachineCapability('durable', durable, 'mutateCoordinatorActionLeaseHeartbeat')
    const mutateCoordinatorActionLeaseRelease = requireQueueMachineCapability('durable', durable, 'mutateCoordinatorActionLeaseRelease')
    const mutateCoordinatorActionLeaseRequest = requireQueueMachineCapability('durable', durable, 'mutateCoordinatorActionLeaseRequest')
    const mutateCoordinatorActionLeasesForTabRelease = requireQueueMachineCapability('durable', durable, 'mutateCoordinatorActionLeasesForTabRelease')
    const mutateCoordinatorFailedItemsRequeue = requireQueueMachineCapability('durable', durable, 'mutateCoordinatorFailedItemsRequeue')
    const mutateCoordinatorFailedItemsRetry = requireQueueMachineCapability('durable', durable, 'mutateCoordinatorFailedItemsRetry')
    const mutateCoordinatorKeyOnlyItemTerminate = requireQueueMachineCapability('durable', durable, 'mutateCoordinatorKeyOnlyItemTerminate')
    const mutateCoordinatorPauseStateSet = requireQueueMachineCapability('durable', durable, 'mutateCoordinatorPauseStateSet')
    const mutateCoordinatorQueuedProfileTargetResolve = requireQueueMachineCapability('durable', durable, 'mutateCoordinatorQueuedProfileTargetResolve')
    const recordCoordinatorJobProgress = requireQueueMachineCapability('durable', durable, 'recordCoordinatorJobProgress')
    const recordOwnedBlockedSweepTerminal = requireQueueMachineCapability('durable', durable, 'recordOwnedBlockedSweepTerminal')
    const removePendingSpaceFeedEntries = requireQueueMachineCapability('durable', durable, 'removePendingSpaceFeedEntries')
    const removePendingSpaceFeedUrls = requireQueueMachineCapability('durable', durable, 'removePendingSpaceFeedUrls')
    const recoverExhaustedRolledBackQueuedCoordinatorItem = requireQueueMachineCapability('durable', durable, 'recoverExhaustedRolledBackQueuedCoordinatorItem')
    const requeueDurableActiveCoordinatorItemWithoutActor = requireQueueMachineCapability('durable', durable, 'requeueDurableActiveCoordinatorItemWithoutActor')
    const settleExhaustedRolledBackQueuedCoordinatorItemsForExecutor = requireQueueMachineCapability('durable', durable, 'settleExhaustedRolledBackQueuedCoordinatorItemsForExecutor')
    const terminateExhaustedRolledBackQueuedCoordinatorItem = requireQueueMachineCapability('durable', durable, 'terminateExhaustedRolledBackQueuedCoordinatorItem')
    const mutateCoordinatorRunsPausedSet = requireQueueMachineCapability('durable', durable, 'mutateCoordinatorRunsPausedSet')
    const mutateCoordinatorStaleRetryQueuedTabAdvance = requireQueueMachineCapability('durable', durable, 'mutateCoordinatorStaleRetryQueuedTabAdvance')
    const mutateCoordinatorStoredWorkCancel = requireQueueMachineCapability('durable', durable, 'mutateCoordinatorStoredWorkCancel')
    const mutateCoordinatorStoredWorkItemCancel = requireQueueMachineCapability('durable', durable, 'mutateCoordinatorStoredWorkItemCancel')
    const mutateCoordinatorStoredWorkPause = requireQueueMachineCapability('durable', durable, 'mutateCoordinatorStoredWorkPause')
    const terminateDurableActiveCoordinatorItemFromTerminalProgress = requireQueueMachineCapability('durable', durable, 'terminateDurableActiveCoordinatorItemFromTerminalProgress')
    const terminateActiveCoordinatorNonProfileLanding = requireQueueMachineCapability('durable', durable, 'terminateActiveCoordinatorNonProfileLanding')
    const terminateActiveCoordinatorProfileRedirectMismatch = requireQueueMachineCapability('durable', durable, 'terminateActiveCoordinatorProfileRedirectMismatch')
    const terminateQueuedAuthorityEnqueueFailureCoordinatorItems = requireQueueMachineCapability('durable', durable, 'terminateQueuedAuthorityEnqueueFailureCoordinatorItems')
    const settleTerminalCoordinatorItems = requireQueueMachineCapability('durable', durable, 'settleTerminalCoordinatorItems')
    const planQueuedActivationIntentForSlotEvent = requireQueueMachineCapability('projection', projection, 'planQueuedActivationIntentForSlotEvent')
    const reprimeQueuedTabActionsForNoOpenEvent = requireQueueMachineCapability('projection', projection, 'reprimeQueuedTabActionsForNoOpenEvent')
    const recoverPendingTabActionFromCoordinatorQueue = requireQueueMachineCapability('runtime', runtime, 'recoverPendingTabActionFromCoordinatorQueue')
    const recoverQueuedAuthorityLiveTabAfterMaterializationFailure = requireQueueMachineCapability('runtime', runtime, 'recoverQueuedAuthorityLiveTabAfterMaterializationFailure')
    const recoverQueuedRuntimeActionsAfterExecutorEnqueueTimeout = requireQueueMachineCapability('runtime', runtime, 'recoverQueuedRuntimeActionsAfterExecutorEnqueueTimeout')
    const releaseQueuedTabRuntimeIfAuthorityNotActive = requireQueueMachineCapability('runtime', runtime, 'releaseQueuedTabRuntimeIfAuthorityNotActive')
    const restoreQueuedTabRuntimeFromActiveAuthorityForSender = requireQueueMachineCapability('runtime', runtime, 'restoreQueuedTabRuntimeFromActiveAuthorityForSender')

    return {
        [QUEUE_MACHINE_EVENT_TYPES.ACTION_LEASE_REQUEST]: async (event = {}, operation = {}) => {
            return mutateCoordinatorActionLeaseRequest({
                reason: operation.reason || 'ordinaryMutation',
                profileHref: event.profileHref || '',
                tabId: event.tabId || null,
                attemptId: event.attemptId || '',
                attemptNumber: event.attemptNumber || 0,
                actionKind: event.actionKind || '',
                requestReason: event.requestReason || event.reason || '',
                currentAuthorityState: event.currentAuthorityState || null
            })
        },
        [QUEUE_MACHINE_EVENT_TYPES.ACTION_LEASE_HEARTBEAT]: async (event = {}, operation = {}) => {
            return mutateCoordinatorActionLeaseHeartbeat({
                reason: operation.reason || 'ordinaryMutation',
                profileHref: event.profileHref || '',
                tabId: event.tabId || null,
                attemptId: event.attemptId || '',
                attemptNumber: event.attemptNumber || 0,
                currentAuthorityState: event.currentAuthorityState || null
            })
        },
        [QUEUE_MACHINE_EVENT_TYPES.ACTION_LEASE_RELEASE]: async (event = {}, operation = {}) => {
            return mutateCoordinatorActionLeaseRelease({
                reason: operation.reason || 'ordinaryMutation',
                profileHref: event.profileHref || '',
                tabId: event.tabId || null,
                attemptId: event.attemptId || '',
                attemptNumber: event.attemptNumber || 0,
                releaseReason: event.releaseReason || event.reason || 'released',
                currentAuthorityState: event.currentAuthorityState || null
            })
        },
        [QUEUE_MACHINE_EVENT_TYPES.ACTION_LEASE_TAB_RELEASE]: async (event = {}, operation = {}) => {
            return mutateCoordinatorActionLeasesForTabRelease({
                reason: operation.reason || 'ordinaryMutation',
                tabId: event.tabId || null,
                releaseReason: event.releaseReason || event.reason || 'tab-released',
                now: event.now || 0,
                currentAuthorityState: event.currentAuthorityState || null
            })
        },
        [QUEUE_MACHINE_EVENT_TYPES.COORDINATOR_ITEMS_ENQUEUE]: async (event = {}) => {
            return enqueueCoordinatorItemsStorageLocked(event.request || {})
        },
        [QUEUE_MACHINE_EVENT_TYPES.PROFILE_STATE_CLEAR]: async (event = {}) => {
            return clearProfileNukeState(
                event.profileHref || event.href || '',
                event.reason || ''
            )
        },
        [QUEUE_MACHINE_EVENT_TYPES.TERMINAL_COORDINATOR_ITEMS_SETTLE]: async (event = {}) => {
            return settleTerminalCoordinatorItems(event.options || {})
        },
        [QUEUE_MACHINE_EVENT_TYPES.PENDING_SPACE_FEED_URLS_REMOVE]: async (event = {}) => {
            return removePendingSpaceFeedUrls(event.urls || [])
        },
        [QUEUE_MACHINE_EVENT_TYPES.PENDING_SPACE_FEED_ENTRIES_REMOVE]: async (event = {}) => {
            return removePendingSpaceFeedEntries(event.postKeys || [])
        },
        [QUEUE_MACHINE_EVENT_TYPES.SPACE_FEED_PROFILES_CONFIRM]: async (event = {}) => {
            return confirmSpaceFeedProfilesBlocked(event.profileHrefs || event.urls || [])
        },
        [QUEUE_MACHINE_EVENT_TYPES.BLOCKED_SWEEP_TERMINAL_RECORD]: async (event = {}) => {
            return recordOwnedBlockedSweepTerminal(
                event.tabId || null,
                event.metadata || null,
                event.response || {}
            )
        },
        [QUEUE_MACHINE_EVENT_TYPES.ACTIVE_MISSING_TAB]: async (event = {}, operation = {}) => {
            const itemKey = event.itemKey || event.rowKey || event.coordinatorKey || event.href || ''
            const residentState = getHydratedCoordinatorAuthorityState('activeMissingTab.usedResidentAuthority')
            const residentItem = residentState?.queue?.[itemKey] ||
                residentState?.queue?.[event.href || ''] ||
                residentState?.queue?.[event.coordinatorKey || ''] ||
                null
            return requeueDurableActiveCoordinatorItemWithoutActor(
                itemKey,
                event.item || null,
                event.record || null,
                event.reason || operation.reason || 'coordinator-executor-active-missing-tab',
                {
                    currentAuthorityState: event.currentAuthorityState || null,
                    timeoutMs: event.timeoutMs || QUEUE_CRITICAL_STORAGE_UPDATE_TIMEOUT_MS,
                    skipFreshOpenDeferralAfterLeaseRelease: event.skipFreshOpenDeferralAfterLeaseRelease === true,
                    skipActionPhaseProtection: event.skipActionPhaseProtection === true,
                    skipFreshContentReadiness: event.skipFreshContentReadiness === true,
                    skipLiveReclaimAdoption: event.skipLiveReclaimAdoption === true,
                    forceRequeueExhaustedActorless: event.forceRequeueExhaustedActorless === true,
                    extendActorlessRetryBudget: event.extendActorlessRetryBudget === true
                }
            )
        },
        [QUEUE_MACHINE_EVENT_TYPES.ACTIVE_NON_PROFILE_LANDING]: async (event = {}, operation = {}) => {
            return terminateActiveCoordinatorNonProfileLanding(
                event.itemKey || event.rowKey || event.coordinatorKey || event.href || '',
                event.landingUrl || event.url || '',
                {
                    reason: operation.reason || event.reason || 'reconcile',
                    expectedAttemptId: event.expectedAttemptId || '',
                    expectedAttemptNumber: event.expectedAttemptNumber || 0,
                    reconcileReason: event.reconcileReason || event.reason || 'non-profile-landing'
                }
            )
        },
        [QUEUE_MACHINE_EVENT_TYPES.ACTIVE_PROFILE_REDIRECT_MISMATCH]: async (event = {}, operation = {}) => {
            return terminateActiveCoordinatorProfileRedirectMismatch(
                event.itemKey || event.rowKey || event.coordinatorKey || event.href || '',
                event.requestedHref || '',
                event.resolvedHref || '',
                {
                    reason: operation.reason || event.reason || 'reconcile',
                    expectedAttemptId: event.expectedAttemptId || '',
                    expectedAttemptNumber: event.expectedAttemptNumber || 0,
                    reconcileReason: event.reconcileReason || event.reason || 'profile-redirect-mismatch'
                }
            )
        },
        [QUEUE_MACHINE_EVENT_TYPES.ACTIVE_TERMINAL_PROGRESS]: async (event = {}, operation = {}) => {
            return terminateDurableActiveCoordinatorItemFromTerminalProgress(
                event.itemKey || event.rowKey || event.coordinatorKey || event.href || '',
                event.item || null,
                event.record || null,
                event.reason || operation.reason || 'reconcile-terminal-progress-active',
                {
                    currentAuthorityState: event.currentAuthorityState || null,
                    timeoutMs: event.timeoutMs || QUEUE_CRITICAL_STORAGE_UPDATE_TIMEOUT_MS
                }
            )
        },
        [QUEUE_MACHINE_EVENT_TYPES.RUNS_PAUSED_SET]: async (event = {}, operation = {}) => {
            return mutateCoordinatorRunsPausedSet({
                reason: operation.reason || 'ordinaryMutation',
                paused: event.paused === true
            })
        },
        [QUEUE_MACHINE_EVENT_TYPES.PAUSE_STATE_SET]: async (event = {}, operation = {}) => {
            return mutateCoordinatorPauseStateSet({
                reason: operation.reason || event.reason || 'ordinaryMutation',
                paused: event.paused === true,
                pauseGeneration: event.pauseGeneration || 0
            })
        },
        [QUEUE_MACHINE_EVENT_TYPES.PAUSE_STORED_WORK]: async (event = {}, operation = {}) => {
            return mutateCoordinatorStoredWorkPause({
                reason: operation.reason || 'ordinaryMutation',
                pauseReason: event.pauseReason || event.reason || 'coordinator-pause-request',
                pauseGeneration: event.pauseGeneration || 0
            })
        },
        [QUEUE_MACHINE_EVENT_TYPES.CANCEL_STORED_WORK]: async (event = {}, operation = {}) => {
            return mutateCoordinatorStoredWorkCancel({
                reason: operation.reason || 'ordinaryMutation',
                cancelReason: event.cancelReason || event.reason || 'coordinator-pause-request'
            })
        },
        [QUEUE_MACHINE_EVENT_TYPES.CANCEL_STORED_WORK_ITEM]: async (event = {}, operation = {}) => {
            return mutateCoordinatorStoredWorkItemCancel({
                reason: operation.reason || 'ordinaryMutation',
                cancelReason: event.cancelReason || event.reason || 'coordinator-pause-request',
                coordinatorKey: event.coordinatorKey || '',
                storageKey: event.storageKey || '',
                profileHref: event.profileHref || ''
            })
        },
        [QUEUE_MACHINE_EVENT_TYPES.KEY_ONLY_TERMINATE]: async (event = {}, operation = {}) => {
            return mutateCoordinatorKeyOnlyItemTerminate({
                reason: operation.reason || event.reason || 'reconcile',
                coordinatorKey: event.coordinatorKey || '',
                terminalOptions: event.terminalOptions || {}
            })
        },
        [QUEUE_MACHINE_EVENT_TYPES.STALE_RETRY_ADVANCE]: async (event = {}, operation = {}) => {
            return mutateCoordinatorStaleRetryQueuedTabAdvance({
                reason: operation.reason || 'ordinaryMutation',
                action: event.action || null,
                at: event.at || 0,
                href: event.href || '',
                coordinatorKey: event.coordinatorKey || ''
            })
        },
        [QUEUE_MACHINE_EVENT_TYPES.PROFILE_TARGET_RESOLVE]: async (event = {}, operation = {}) => {
            return mutateCoordinatorQueuedProfileTargetResolve({
                reason: operation.reason || 'ordinaryMutation',
                request: event.request || {},
                resolvedHref: event.resolvedHref || '',
                tabId: event.tabId || null,
                requestedUrl: event.requestedUrl || '',
                oldKey: event.oldKey || '',
                oldProfileHref: event.oldProfileHref || ''
            })
        },
        [QUEUE_MACHINE_EVENT_TYPES.PROGRESS_PATCH_RECORD]: async (event = {}) => {
            return recordCoordinatorJobProgress(
                event.profileHref || event.href || '',
                event.patch || {},
                event.options || {}
            )
        },
        [QUEUE_MACHINE_EVENT_TYPES.PROFILE_RESOLUTION_UNRESOLVED]: async (event = {}) => {
            return markQueuedProfileResolutionUnresolved(
                event.request || {},
                event.sender || {}
            )
        },
        [QUEUE_MACHINE_EVENT_TYPES.ROW_EVENTS_APPLY]: async (event = {}) => {
            return applyCoordinatorRowEvents(
                event.events || [],
                event.options || {}
            )
        },
        [QUEUE_MACHINE_EVENT_TYPES.EXHAUSTED_ROLLBACK_RECOVER]: async (event = {}) => {
            return recoverExhaustedRolledBackQueuedCoordinatorItem(
                event.itemKey || event.rowKey || event.href || event.coordinatorKey || '',
                event.item || null,
                event.options || {}
            )
        },
        [QUEUE_MACHINE_EVENT_TYPES.EXHAUSTED_ROLLBACK_SETTLE]: async (event = {}) => {
            return settleExhaustedRolledBackQueuedCoordinatorItemsForExecutor(
                event.items || [],
                event.options || {}
            )
        },
        [QUEUE_MACHINE_EVENT_TYPES.EXHAUSTED_ROLLBACK_TERMINATE]: async (event = {}) => {
            return terminateExhaustedRolledBackQueuedCoordinatorItem(
                event.itemKey || event.rowKey || event.href || event.coordinatorKey || '',
                event.item || null,
                event.options || {}
            )
        },
        [QUEUE_MACHINE_EVENT_TYPES.QUEUED_NO_OPEN_REPRIME]: async (event = {}) => {
            return reprimeQueuedTabActionsForNoOpenEvent(event)
        },
        [QUEUE_MACHINE_EVENT_TYPES.SLOT_AVAILABLE]: async (event = {}) => {
            return planQueuedActivationIntentForSlotEvent(event)
        },
        [QUEUE_MACHINE_EVENT_TYPES.TAB_OPENED]: async (event = {}, operation = {}) => {
            const type = normalizeQueueMachineEventType(event?.type || '')
            return mutateCoordinatorQueuedTabActiveTransition({
                reason: operation.reason || 'ordinaryMutation',
                action: event.action || {},
                tab: event.tab || {},
                details: {
                    ...(event.details || {}),
                    machineEventType: type,
                    machineEventRowKey: event.rowKey || event.coordinatorKey || event.href || ''
                },
                href: event.href || '',
                coordinatorKey: event.coordinatorKey || event.rowKey || ''
            })
        },
        [QUEUE_MACHINE_EVENT_TYPES.TAB_OPEN_TIMEOUT]: async (event = {}, operation = {}) => {
            const type = normalizeQueueMachineEventType(event?.type || '')
            return mutateCoordinatorQueuedTabOpenRollback({
                reason: operation.reason || 'ordinaryMutation',
                action: event.action || {},
                tab: event.tab || {},
                details: {
                    ...(event.details || {}),
                    machineEventType: type,
                    machineEventRowKey: event.rowKey || event.coordinatorKey || event.href || ''
                },
                href: event.href || '',
                coordinatorKey: event.coordinatorKey || event.rowKey || ''
            })
        },
        [QUEUE_MACHINE_EVENT_TYPES.TAB_OPEN_ROLLBACK_UNACKED]: async (event = {}) => {
            const details = event.details || {}
            const href = event.href || ''
            const coordinatorKey = event.coordinatorKey || event.rowKey || ''
            const state = normalizeCoordinatorAuthorityStateInput(details.currentAuthorityState || null) ||
                getHydratedCoordinatorAuthorityState('rollbackFailedQueuedTabOpen.usedResidentAuthority')
            const currentItem = state?.queue?.[href] || state?.queue?.[coordinatorKey] || null
            if(currentItem &&
                isActiveCoordinatorStatus(currentItem.status) &&
                isQueuedTabAttemptBudgetExhausted(currentItem)) {
                return requeueDurableActiveCoordinatorItemWithoutActor(
                    href || coordinatorKey,
                    currentItem,
                    null,
                    'active-transition-failed',
                    {
                        currentAuthorityState: state,
                        skipFreshOpenDeferralAfterLeaseRelease: true,
                        skipFreshContentReadiness: true
                    }
                ).catch(() => null)
            }
            return {
                changed: false,
                reason: 'rollback-unacked-no-exhausted-active-row'
            }
        },
        [QUEUE_MACHINE_EVENT_TYPES.EXECUTOR_ENQUEUE_TIMEOUT]: async (event = {}) => {
            return recoverQueuedRuntimeActionsAfterExecutorEnqueueTimeout(event.ownerTabId || null, {
                currentAuthorityState: event.currentAuthorityState || null,
                reason: event.reason || 'coordinator-executor-enqueue-timeout'
            })
        },
        [QUEUE_MACHINE_EVENT_TYPES.QUEUED_MATERIALIZATION_FAILURE]: async (event = {}) => {
            return recoverQueuedAuthorityLiveTabAfterMaterializationFailure(
                event.item || null,
                event.itemKey || event.rowKey || '',
                event.record || null,
                {
                    ownerTabId: event.ownerTabId || SERVICE_WORKER_QUEUE_OWNER_ID,
                    queueOnlyAuthority: event.queueOnlyAuthority === true,
                    currentAuthorityState: event.currentAuthorityState || null,
                    runtimeSurface: event.runtimeSurface || {}
                }
            )
        },
        [QUEUE_MACHINE_EVENT_TYPES.QUEUED_AUTHORITY_ENQUEUE_FAILURE]: async (event = {}) => {
            return terminateQueuedAuthorityEnqueueFailureCoordinatorItems(event.items || [], {
                operationKind: event.operationKind || 'terminalize-queued-authority-enqueue-failure',
                metricPath: event.metricPath || 'coordinatorExecutor.enqueueFailure.terminalize',
                source: event.source || 'terminalizeQueuedAuthorityEnqueueFailureCoordinatorItems',
                reason: event.failureReason || event.reason || 'queued-authority-enqueue-did-not-materialize-runtime',
                terminalizedReason: event.terminalizedReason ||
                    `terminalized-${event.failureReason || event.reason || 'queued-authority-enqueue-did-not-materialize-runtime'}`,
                retryBeforeTerminal: event.retryBeforeTerminal === true,
                queueOnlyAuthority: event.queueOnlyAuthority === true,
                serviceWorkerOwned: event.serviceWorkerOwned === true,
                recordByKey: event.recordByKey || null,
                error: event.error || '',
                enqueueDiagnostics: event.enqueueDiagnostics || {}
            })
        },
        [QUEUE_MACHINE_EVENT_TYPES.RECOVER_PENDING_TAB_ACTION]: async (event = {}) => {
            return recoverPendingTabActionFromCoordinatorQueue(event.sender || {})
        },
        [QUEUE_MACHINE_EVENT_TYPES.RESTORE_ACTIVE_RUNTIME_FOR_SENDER]: async (event = {}) => {
            return restoreQueuedTabRuntimeFromActiveAuthorityForSender(
                event.tabId || event.sender?.tab?.id || null,
                event.senderTab || event.sender?.tab || null,
                event.metadata || null,
                event.options || {}
            )
        },
        [QUEUE_MACHINE_EVENT_TYPES.RELEASE_RUNTIME_IF_AUTHORITY_NOT_ACTIVE]: async (event = {}) => {
            return releaseQueuedTabRuntimeIfAuthorityNotActive(
                event.tabId || null,
                event.metadata || null,
                event.options || {}
            )
        },
        [QUEUE_MACHINE_EVENT_TYPES.REQUEUE_FAILED_ITEMS]: async (event = {}, operation = {}) => {
            return mutateCoordinatorFailedItemsRequeue({
                reason: operation.reason || 'ordinaryMutation',
                request: event.request || {}
            })
        },
        [QUEUE_MACHINE_EVENT_TYPES.RETRY_FAILED_ITEMS]: async (event = {}, operation = {}) => {
            return mutateCoordinatorFailedItemsRetry({
                reason: operation.reason || 'ordinaryMutation',
                request: event.request || {},
                retryLimit: event.retryLimit || 0,
                maxItems: event.maxItems || 0
            })
        }
    }
}

module.exports = {
    createCoordinatorQueueMachineEventHandlers
}
