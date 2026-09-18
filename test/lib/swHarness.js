const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const {createRequire} = require('node:module')

function clone(value) {
    if(value === undefined) return undefined
    return JSON.parse(JSON.stringify(value))
}

function createFakeTimers(startNow = 0) {
    let now = startNow
    let nextId = 1
    const timers = new Map()

    function setTimeoutFake(callback, delay = 0, ...args) {
        const id = nextId++
        timers.set(id, {
            id,
            dueAt: now + Math.max(0, Number(delay) || 0),
            callback,
            args,
            cleared: false
        })
        return id
    }

    function clearTimeoutFake(id) {
        timers.delete(id)
    }

    async function tick(ms = 0) {
        const target = now + Math.max(0, Number(ms) || 0)

        while(true) {
            let next = null
            for(const timer of timers.values()) {
                if(timer.dueAt <= target && (!next || timer.dueAt < next.dueAt || timer.id < next.id)) {
                    next = timer
                }
            }
            if(!next) break

            timers.delete(next.id)
            now = next.dueAt
            next.callback(...next.args)
            await Promise.resolve()
        }

        now = target
        await Promise.resolve()
    }

    return {
        get now() {
            return now
        },
        setNow(value) {
            now = Number(value) || 0
        },
        setTimeout: setTimeoutFake,
        clearTimeout: clearTimeoutFake,
        tick,
        pending() {
            return Array.from(timers.values())
                .map(timer => ({id: timer.id, dueAt: timer.dueAt}))
                .sort((left, right) => left.dueAt - right.dueAt || left.id - right.id)
        },
        clearAll() {
            timers.clear()
        }
    }
}

function makeEvent() {
    const listeners = []
    return {
        listeners,
        addListener(listener) {
            listeners.push(listener)
        },
        removeListener(listener) {
            const index = listeners.indexOf(listener)
            if(index >= 0) listeners.splice(index, 1)
        },
        async emit(...args) {
            const results = []
            for(const listener of listeners) {
                results.push(await listener(...args))
            }
            return results
        }
    }
}

function createFakeBrowser(initialStorage = {}) {
    const storage = clone(initialStorage) || {}
    const sessionStorage = {}
    const runtimeOnMessage = makeEvent()
    const storageOnChanged = makeEvent()
    const alarmsOnAlarm = makeEvent()
    const alarmCreates = []
    const removedTabs = []
    const tabs = new Map()
    const windows = new Map([[1, {id: 1, focused: true, type: 'normal'}]])
    const windowUpdates = []
    let nextTabId = 100
    let nextWindowId = 2
    let alarmCreateImpl = async alarm => alarm

    function makeChanges(payload, targetStorage = storage) {
        const changes = {}
        for(const [key, value] of Object.entries(payload || {})) {
            changes[key] = {
                oldValue: clone(targetStorage[key]),
                newValue: clone(value)
            }
        }
        return changes
    }

    function makeStorageArea(targetStorage, areaName = 'local') {
        return {
            async get(defaults = {}) {
                if(typeof defaults === 'string') {
                    return {[defaults]: clone(targetStorage[defaults])}
                }
                if(Array.isArray(defaults)) {
                    const result = {}
                    for(const key of defaults) result[key] = clone(targetStorage[key])
                    return result
                }
                const result = {}
                for(const [key, value] of Object.entries(defaults || {})) {
                    result[key] = targetStorage[key] === undefined ? clone(value) : clone(targetStorage[key])
                }
                return result
            },
            async set(payload = {}) {
                const changes = makeChanges(payload, targetStorage)
                for(const [key, value] of Object.entries(payload || {})) {
                    targetStorage[key] = clone(value)
                }
                if(Object.keys(changes).length) {
                    await storageOnChanged.emit(changes, areaName)
                }
            },
            async remove(keys) {
                const list = Array.isArray(keys) ? keys : [keys]
                const changes = {}
                for(const key of list) {
                    changes[key] = {
                        oldValue: clone(targetStorage[key]),
                        newValue: undefined
                    }
                    delete targetStorage[key]
                }
                await storageOnChanged.emit(changes, areaName)
            }
        }
    }

    const browser = {
        storage: {
            local: makeStorageArea(storage, 'local'),
            session: makeStorageArea(sessionStorage, 'session'),
            onChanged: storageOnChanged
        },
        runtime: {
            onInstalled: makeEvent(),
            onStartup: makeEvent(),
            onMessage: runtimeOnMessage,
            getURL(relativePath = '') {
                return `moz-extension://mute-block/${relativePath}`
            },
            getManifest() {
                return {version: 'test'}
            },
            async sendMessage(message, sender = {}) {
                for(const listener of runtimeOnMessage.listeners) {
                    const result = listener(message, sender, () => {})
                    if(result !== undefined) return await result
                }
                return undefined
            }
        },
        alarms: {
            onAlarm: alarmsOnAlarm,
            async create(name, info = {}) {
                alarmCreates.push({name, info: clone(info)})
                return alarmCreateImpl({name, info})
            },
            async clear(name) {
                alarmCreates.push({name, cleared: true})
                return true
            }
        },
        tabs: {
            onRemoved: makeEvent(),
            onUpdated: makeEvent(),
            async query(queryInfo = {}) {
                const allTabs = Array.from(tabs.values())
                let filtered = allTabs
                if(queryInfo?.active === true) {
                    filtered = filtered.filter(tab => tab.active === true)
                }
                if(queryInfo?.lastFocusedWindow === true) {
                    const focusedWindow = Array.from(windows.values()).find(win => win.focused === true) ||
                        windows.get(1) ||
                        null
                    filtered = focusedWindow
                        ? filtered.filter(tab => tab.windowId === focusedWindow.id)
                        : []
                }
                const urlFilter = queryInfo?.url
                if(!urlFilter) return clone(filtered)

                const patterns = Array.isArray(urlFilter) ? urlFilter : [urlFilter]
                return clone(filtered.filter(tab => patterns.some(pattern => matchUrlPattern(tab.url || '', pattern))))
            },
            async get(tabId) {
                const tab = tabs.get(Number.parseInt(tabId, 10))
                if(!tab) throw new Error(`no fake tab ${tabId}`)
                return clone(tab)
            },
            async create(options = {}) {
                const focusedWindow = Array.from(windows.values()).find(win => win.focused === true) ||
                    windows.get(1) ||
                    {id: 1}
                const windowId = options.windowId || focusedWindow.id || 1
                if(!windows.has(windowId)) {
                    windows.set(windowId, {id: windowId, focused: false, type: 'normal'})
                }
                if(options.active === true) {
                    for(const existing of tabs.values()) {
                        if(existing.windowId === windowId) existing.active = false
                    }
                }
                const tab = {
                    id: nextTabId++,
                    windowId,
                    url: options.url || '',
                    active: options.active === true
                }
                tabs.set(tab.id, tab)
                return clone(tab)
            },
            async update(tabId, options = {}) {
                const normalizedTabId = Number.parseInt(tabId, 10)
                if(options.active === true) {
                    const windowId = options.windowId ||
                        tabs.get(normalizedTabId)?.windowId ||
                        1
                    for(const existing of tabs.values()) {
                        if(existing.windowId === windowId && existing.id !== normalizedTabId) {
                            existing.active = false
                        }
                    }
                }
                const existing = tabs.get(normalizedTabId) || {
                    id: normalizedTabId,
                    windowId: options.windowId || 1,
                    url: ''
                }
                const tab = {
                    ...existing,
                    ...clone(options),
                    id: normalizedTabId,
                    windowId: options.windowId || existing.windowId || 1,
                    active: options.active === undefined ? existing.active === true : options.active === true
                }
                tabs.set(normalizedTabId, tab)
                await browser.tabs.onUpdated.emit(normalizedTabId, {status: 'complete'}, clone(tab))
                return clone(tab)
            },
            async remove(tabId) {
                const normalizedTabId = Number.parseInt(tabId, 10)
                removedTabs.push(normalizedTabId)
                tabs.delete(normalizedTabId)
                await browser.tabs.onRemoved.emit(normalizedTabId, {isWindowClosing: false})
            },
            async reload(tabId) {
                const normalizedTabId = Number.parseInt(tabId, 10)
                const tab = tabs.get(normalizedTabId)
                if(!tab) throw new Error(`no fake tab ${tabId}`)
                tabs.set(normalizedTabId, {
                    ...tab,
                    status: 'loading'
                })
                await browser.tabs.onUpdated.emit(normalizedTabId, {status: 'loading'}, clone(tabs.get(normalizedTabId)))
                return undefined
            },
            async sendMessage() {
                return {}
            }
        },
        windows: {
            async create(options = {}) {
                const id = nextWindowId++
                const focused = options.focused === true
                if(focused) {
                    for(const win of windows.values()) win.focused = false
                }
                const win = {
                    id,
                    focused,
                    type: options.type || 'normal'
                }
                windows.set(id, win)
                const tab = {
                    id: nextTabId++,
                    windowId: id,
                    url: options.url || '',
                    active: true
                }
                tabs.set(tab.id, tab)
                return clone({
                    ...win,
                    tabs: [tab]
                })
            },
            async get(windowId, options = {}) {
                const normalizedWindowId = Number.parseInt(windowId, 10)
                const win = windows.get(normalizedWindowId)
                if(!win) throw new Error(`no fake window ${windowId}`)
                const result = clone(win)
                if(options.populate === true) {
                    result.tabs = clone(Array.from(tabs.values()).filter(tab => tab.windowId === normalizedWindowId))
                }
                return result
            },
            async update(windowId, options = {}) {
                const normalizedWindowId = Number.parseInt(windowId, 10)
                const win = windows.get(normalizedWindowId) || {
                    id: normalizedWindowId,
                    focused: false,
                    type: 'normal'
                }
                if(options.focused === true) {
                    for(const existing of windows.values()) existing.focused = false
                    win.focused = true
                }
                else if(options.focused === false) {
                    win.focused = false
                }
                windows.set(normalizedWindowId, win)
                windowUpdates.push({windowId: normalizedWindowId, options: clone(options)})
                return clone(win)
            },
            async remove(windowId) {
                const normalizedWindowId = Number.parseInt(windowId, 10)
                windows.delete(normalizedWindowId)
                const tabIds = Array.from(tabs.values())
                    .filter(tab => tab.windowId === normalizedWindowId)
                    .map(tab => tab.id)
                for(const tabId of tabIds) {
                    tabs.delete(tabId)
                    removedTabs.push(tabId)
                    await browser.tabs.onRemoved.emit(tabId, {isWindowClosing: true})
                }
            }
        },
        webRequest: {
            onCompleted: makeEvent()
        },
        scripting: {
            async executeScript() {
                return []
            },
            async insertCSS() {
                return []
            }
        },
        __storage: storage,
        __sessionStorage: sessionStorage,
        __tabs: tabs,
        __windows: windows,
        __windowUpdates: windowUpdates,
        __alarmCreates: alarmCreates,
        __removedTabs: removedTabs,
        __setNextTabId(value) {
            const normalized = Number.parseInt(value, 10)
            if(Number.isFinite(normalized) && normalized > 0) nextTabId = normalized
        },
        __setAlarmCreateImpl(impl) {
            alarmCreateImpl = impl
        }
    }

    return browser
}

function matchUrlPattern(url = '', pattern = '') {
    if(!pattern || pattern === '<all_urls>') return true
    const escaped = `${pattern}`
        .replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
        .replace(/\*/g, '.*')
    return new RegExp(`^${escaped}$`).test(`${url || ''}`)
}

// Process-scope cache: compiled vm.Script objects only, never module
// instances/exports -- a Script can be safely re-run against a different
// context to produce fresh, isolated state per harness instantiation.
const compiledModuleScripts = new Map() // absolutePath -> vm.Script

function createSharedRealmRequire(context, browser, baseRequire) {
    const moduleCache = new Map() // absolutePath -> {exports}

    function requireFrom(callerDir) {
        return function localRequire(request) {
            if(request === 'webextension-polyfill') return browser
            if(!request.startsWith('.')) return baseRequire(request)

            let resolvedPath = path.resolve(callerDir, request)
            if(!resolvedPath.endsWith('.js')) resolvedPath += '.js'

            if(moduleCache.has(resolvedPath)) {
                return moduleCache.get(resolvedPath).exports
            }

            const moduleRecord = {exports: {}}
            moduleCache.set(resolvedPath, moduleRecord) // insert before running the body, for circular-require safety (matches Node's require cache ordering)

            let script = compiledModuleScripts.get(resolvedPath)
            if(!script) {
                const source = fs.readFileSync(resolvedPath, 'utf8')
                const wrapper = `(function(exports, require, module, __filename, __dirname) {\n${source}\n})`
                script = new vm.Script(wrapper, {filename: resolvedPath})
                compiledModuleScripts.set(resolvedPath, script)
            }

            const compiled = script.runInContext(context)
            const moduleDir = path.dirname(resolvedPath)
            compiled(moduleRecord.exports, requireFrom(moduleDir), moduleRecord, resolvedPath, moduleDir)

            return moduleRecord.exports
        }
    }

    return requireFrom
}

function loadServiceWorkerHarness(options = {}) {
    const repoRoot = path.resolve(__dirname, '..', '..')
    const swPath = path.join(repoRoot, 'shared/js/sw.js')
    const timers = options.timers || createFakeTimers(options.now || 0)
    const browser = options.browser || createFakeBrowser(options.storage || {})
    const baseRequire = createRequire(swPath)
    let source = `let __testHarnessDeactivated = false;\nlet __testCoordinatorExecutorStartThrow = null;\n${fs.readFileSync(swPath, 'utf8')}`

    if(!options.runStartupWork) {
        source = source
            .replace(/\nvoid startQueueWakeupMetricsBackedStartupWork\(\)/, '\n')
            .replace(/\nscheduleStoredWorkRearmAfterServiceWorkerReload\(\)/, '\n')
    }
    if(options.disableQueueWakeupMetricsFlush === true) {
        source = source.replace(
            'function scheduleQueueWakeupMetricsFlush() {\n    queueWakeupMetricsDirty = true',
            'function scheduleQueueWakeupMetricsFlush() {\n    queueWakeupMetricsDirty = false\n    return'
        )
    }
    if(options.disableQueueWalCheckpointSwitch === true) {
        const needle = "function scheduleCoordinatorQueueWalCheckpointSwitch(reason = 'segment-soft-threshold', committedSegments = 0) {\n    const normalizedReason = `${reason || 'segment-soft-threshold'}`.trim() || 'segment-soft-threshold'"
        if(!source.includes(needle)) {
            throw new Error('disableQueueWalCheckpointSwitch patch target not found in sw.js -- signature drifted, update swHarness.js')
        }
        source = source.replace(
            needle,
            "function scheduleCoordinatorQueueWalCheckpointSwitch(reason = 'segment-soft-threshold', committedSegments = 0) {\n    return null\n    const normalizedReason = `${reason || 'segment-soft-threshold'}`.trim() || 'segment-soft-threshold'"
        )
    }
    if(options.fastExecutorResumeTimeoutMs) {
        const timeoutMs = Math.max(1000, Number.parseInt(options.fastExecutorResumeTimeoutMs, 10) || 0)
        source = source.replace(
            'const COORDINATOR_FAST_EXECUTOR_RESUME_TIMEOUT_MS = 180000',
            `const COORDINATOR_FAST_EXECUTOR_RESUME_TIMEOUT_MS = ${timeoutMs}`
        )
    }
    if(options.shadowWalRecordLimit) {
        const recordLimit = Math.max(2, Number.parseInt(options.shadowWalRecordLimit, 10) || 0)
        source = source
            .replace(
                'const MAX_COORDINATOR_AUTHORITY_SHADOW_WAL_RECORDS = 128',
                `const MAX_COORDINATOR_AUTHORITY_SHADOW_WAL_RECORDS = ${recordLimit}`
            )
            .replace(
                'const MAX_PROGRESS_SHADOW_WAL_RECORDS = 128',
                `const MAX_PROGRESS_SHADOW_WAL_RECORDS = ${recordLimit}`
            )
    }
    source = source.replace(
        'async function enqueueExistingExecutorForCoordinator(items = [], coordinator = {}, options = {}) {\n    clearStaleCoordinatorExecutorStartPromise',
        'async function enqueueExistingExecutorForCoordinator(items = [], coordinator = {}, options = {}) {\n    if(__testCoordinatorExecutorStartThrow) {\n        const error = __testCoordinatorExecutorStartThrow\n        __testCoordinatorExecutorStartThrow = null\n        throw error\n    }\n    clearStaleCoordinatorExecutorStartPromise'
    )
    source = source.replace(
        'async function metricStorageGet(defaults = {}, options = {}) {\n    incrementQueueWakeupMetric',
        'async function metricStorageGet(defaults = {}, options = {}) {\n    if(__testHarnessDeactivated) return cloneCoordinatorAuthorityValue(defaults || {})\n    incrementQueueWakeupMetric'
    )
    source = source.replace(
        'async function metricStorageSet(payload = {}, options = {}) {\n    if(payload &&',
        'async function metricStorageSet(payload = {}, options = {}) {\n    if(__testHarnessDeactivated) return false\n    if(payload &&'
    )
    source = source.replace(
        'async function metricStorageRemove(keys = [], options = {}) {\n    const normalizedKeys',
        'async function metricStorageRemove(keys = [], options = {}) {\n    if(__testHarnessDeactivated) return false\n    const normalizedKeys'
    )
    source = source.replace(
        'function recoverCoordinatorQueueFromWal(snapshotQueue = {}, walStore = null, options = {}) {\n    const normalizedSnapshot',
        'function recoverCoordinatorQueueFromWal(snapshotQueue = {}, walStore = null, options = {}) {\n    const normalizedSnapshot'
    )
    source = source.replace(
        '    if(!walStore || typeof walStore !== \'object\') {\n        return {',
        '    if(__testHarnessDeactivated) {\n        return {\n            queue: normalizedSnapshot,\n            recovered: false,\n            reason: \'test-harness-deactivated\'\n        }\n    }\n\n    if(!walStore || typeof walStore !== \'object\') {\n        return {'
    )
    source += `

module.exports.__test = {
    applyCoordinatorRowEvent,
    applyCoordinatorRowEvents,
    buildCoordinatorQueueView,
    buildCoordinatorContentQueueIndex,
    coordinatorRawQueueNormalizationChangedRows,
    normalizeRawCoordinatorQueueForReconcileFallback,
    getOwnedNukeStatus,
    buildQueueWakeupMetricsView,
    classifyCoordinatorExecutorState,
    coordinatorAuthority,
    enqueueSpaceFeedStorageUpdate,
    enqueueExistingExecutorForCoordinator,
    buildQueuedTabOpenEffectPlan,
    applyQueuedTabOpenRuntimeEffect,
    confirmQueuedTabOpenDurableActiveEffect,
    kickCoordinatorQueueResume,
    metricStorageGet,
    metricStorageSet,
    recoverStoredCoordinatorWork,
    ensureQueuedTabContentScript,
    handleQueuedTabContentScriptEnsureResult,
    nudgeQueuedTabActionClaim,
    nudgeQueuedTabActionClaimWithRetries,
    ensureProfileNukeProgressReady,
    reconcileCoordinatorStorage,
    recordCoordinatorJobProgress,
    recordCoordinatorJobProgressRecords,
    recordFlightRecorderEvent,
    getFlightRecorder,
    getFlightRecorderSnapshot,
    getCoordinatorWhyNotRunning,
    getStorageUpdateQueueSnapshot,
    recoverQueuedAuthorityLiveTabAfterMaterializationFailure,
    isQueuedTabRetryBudgetReleaseReason,
    getExhaustedRolledBackQueuedTabTerminalError,
    shouldAdvanceRolledBackQueuedTabBeforeOpen,
    recordQueuedTabMetadataMilestone,
    getCoordinatorQueueAccounting,
    refreshCoordinatorQueueViewForDashboard,
    refreshQueueWakeupMetricsViewForDashboard,
    rememberQueueLoadPressure,
    runCoordinatorExecutorApplyPhase,
    runCoordinatorQueueExecutorFastPath,
    recordDeferredCoordinatorJobMilestone,
    flushCoordinatorJobMilestones,
    resetQueueWakeupMetricsEpochAfterLoad,
    rollbackFailedQueuedTabOpen,
    resolveQueuedStaleRuntimeExecutorCase,
    shouldEscalateQueuedTabClaimNudgeTimeout,
    transitionCoordinatorItemForQueuedTab,
    requestCoordinatorActionLease,
    heartbeatCoordinatorActionLease,
    releaseCoordinatorActionLease,
    releaseCoordinatorActionLeaseForTab,
    releaseQueuedTabAndCleanup,
    requeueDurableActiveCoordinatorItemWithoutActor,
    runCoordinatorAuthorityReconcileActions,
    runCoordinatorReconcileTick,
    pruneMissingQueuedTabRuntimeState,
    resumeCoordinatorQueueExecution,
    resumeCoordinatorQueueExecutionOnce,
    restoreCoordinatorPageForStoredWork,
    runCoordinatorQueueExecutorFastPath,
    runScheduledCoordinatorReconcileTick,
    saveCoordinatorState,
    awaitCoordinatorResumeAlarmPersistence,
    pauseCoordinatorNukes,
    scheduleCoordinatorQueueResume,
    scheduleCoordinatorReconcile,
    sendTabMessage,
    setCoordinatorPauseControlState,
    setCoordinatorRunsPaused,
    settleTerminalCoordinatorItems,
    startUserInitiatedCoordinatorQueueResume,
    startQueueWakeupMetricsBackedStartupWork,
    sweepStaleQueuedTabs,
    switchCoordinatorAuthorityQueueWalCheckpoint,
    closeQueuedWorkerActionSurfaceIfIdle,
    terminalizeCoordinatorKeyOnlyItem,
    terminalizeActiveCoordinatorNonProfileLanding,
    terminalizeActiveCoordinatorItemFromBlockedLiveTab,
    terminalizeExhaustedRolledBackQueuedCoordinatorItem,
    terminalizeExhaustedRolledBackQueuedCoordinatorItems,
    __testResetFlightRecorder,
    __testDeactivateHarness() {
        __testHarnessDeactivated = true
        if(storageUpdateState.getActiveRawToken()) {
            storageUpdateState.abandon(storageUpdateState.getActiveRawToken())
        }
        queueWakeupMetricsLoaded = false
        queueWakeupMetricsDirty = false
        queueWakeupMetricsFlushPromise = null
        coordinatorQueueResumeScheduler.clearSchedule()
        coordinatorQueueResumeScheduler.clearAlarmTracking()
        coordinatorReconcileScheduler.clearSchedule()
        coordinatorReconcileScheduler.resetBackoff()
    },
    __testAddProvisionalQueuedTab(tabId, metadata = {}, action = null) {
        queueRuntime.addActiveQueuedTab(tabId)
        setQueuedTabMetadata(tabId, metadata)
        queueRuntime.setPendingTabAction(tabId, action || {
            action: metadata.tabAction || 'nuke',
            targetUrl: metadata.profileHref || '',
            coordinatorKey: metadata.coordinatorKey || '',
            requestedUrl: metadata.requestedUrl || '',
            actionKind: metadata.actionKind || 'mute-block',
            runId: metadata.runId || '',
            ownerTabId: metadata.ownerTabId || SERVICE_WORKER_QUEUE_OWNER_ID,
            ownerWindowId: metadata.ownerWindowId || null,
            attemptId: metadata.attemptId || '',
            attemptNumber: metadata.attemptNumber || 0
        })
        registerOwnedTab(metadata.ownerTabId || SERVICE_WORKER_QUEUE_OWNER_ID, tabId)
    },
    __testAddActiveQueuedTabWithoutMetadata(tabId) {
        queueRuntime.addActiveQueuedTab(tabId)
        registerOwnedTab(SERVICE_WORKER_QUEUE_OWNER_ID, tabId)
    },
    __testAddQueuedAction(action = {}) {
        queueRuntime.enqueueActivationIntent({
            url: action.url || action.profileHref || '',
            profileHref: action.profileHref || action.url || '',
            coordinatorKey: action.coordinatorKey || action.profileHref || action.url || '',
            requestedUrl: action.requestedUrl || action.url || action.profileHref || '',
            tabAction: action.tabAction || 'nuke',
            actionKind: action.actionKind || 'mute-block',
            ownerTabId: action.ownerTabId || SERVICE_WORKER_QUEUE_OWNER_ID,
            ownerWindowId: action.ownerWindowId || null,
            attemptId: action.attemptId || '',
            attemptNumber: action.attemptNumber || 0,
            runId: action.runId || '',
            ...action
        }, {
            source: action.activationIntentSource || 'machine-intent'
        })
    },
    __testClearQueuedActions() {
        queueRuntime.replaceActivationIntents([])
    },
    __testClaimQueuedActivationGuard(action = {}, tab = null, reason = 'test') {
        return claimQueuedActivationGuard(action, tab, reason)
    },
    __testSetCoordinatorAuthorityShadowWalStore(value) {
        coordinatorAuthorityShadowWalStore = value
    },
    __testSetProgressShadowWalStore(value) {
        progressShadowWalStore = value
    },
    __testPauseQueuedOwner(ownerTabId) {
        queueRuntime.pauseQueuedOwner(ownerTabId)
    },
    __testSetQueuedTabFillPromise(promise, startedAt = Date.now()) {
        queuedTabFillPromise = promise
        queuedTabFillPromiseStartedAt = Number.parseInt(startedAt, 10) || Date.now()
    },
    __testSetQueuedTabFillOpeningAction(action = null) {
        const key = getQueuedRuntimeActionFillKey(action) || ''
        queuedTabFillOpeningActionKeys = key ? new Set([key]) : new Set()
    },
    __testSetCoordinatorExecutorStartPromise(promise, startedAt = Date.now()) {
        coordinatorExecutorStartPromise = promise
        coordinatorExecutorStartPromiseStartedAt = Number.parseInt(startedAt, 10) || Date.now()
    },
    __testSetCoordinatorExecutorStartThrow(error) {
        __testCoordinatorExecutorStartThrow = error
    },
    __testSetCoordinatorReconcilePromise(promise, startedAt = Date.now()) {
        coordinatorReconcilePromise = promise
        coordinatorReconcilePromiseStartedAt = Number.parseInt(startedAt, 10) || Date.now()
    },
    __testClearStaleCoordinatorReconcilePromise(reason = 'test') {
        return clearStaleCoordinatorReconcilePromise(reason)
    },
    __testClearStaleCoordinatorExecutorStartPromise(reason = 'test') {
        return clearStaleCoordinatorExecutorStartPromise(reason)
    },
    state() {
        return {
            coordinatorReconcileDueAt: coordinatorReconcileScheduler.getDueAt(),
            hasCoordinatorReconcileTimeout: coordinatorReconcileScheduler.hasTimeout(),
            coordinatorReconcileBackoffLevel: coordinatorReconcileScheduler.getBackoffLevel(),
            coordinatorReconcileBackoffUntil: coordinatorReconcileScheduler.getBackoffUntil(),
            coordinatorQueueResumeDueAt: coordinatorQueueResumeScheduler.getDueAt(),
            hasCoordinatorQueueResumeTimeout: coordinatorQueueResumeScheduler.hasTimeout(),
            queueWakeupCounters: {...getQueueWakeupMetricEpoch().counters},
            profileNukeProgress: {...profileNukeProgress},
            coordinatorAuthorityShadowWalStore: JSON.parse(JSON.stringify(coordinatorAuthorityShadowWalStore)),
            progressShadowWalStore: JSON.parse(JSON.stringify(progressShadowWalStore)),
            coordinatorQueueWal: JSON.parse(JSON.stringify(coordinatorAuthority.current().stored?.mbCoordinatorQueueWal || null)),
            spaceFeedStorageUpdateDepth: storageUpdateState.getDepth(),
            abandonedSpaceFeedStorageUpdates: storageUpdateState.getAbandonedCount(),
            queuedTabFillPromise: hasVisibleQueuedTabFillPromise(),
            queuedTabFillPromiseAgeMs: hasVisibleQueuedTabFillPromise() ? getPromiseLatchAgeMs(queuedTabFillPromiseStartedAt) : 0,
            coordinatorReconcilePromise: !!coordinatorReconcilePromise,
            coordinatorReconcilePromiseAgeMs: coordinatorReconcilePromise ? getPromiseLatchAgeMs(coordinatorReconcilePromiseStartedAt) : 0,
            coordinatorExecutorStartPromise: !!coordinatorExecutorStartPromiseStartedAt,
            coordinatorExecutorStartPromiseAgeMs: coordinatorExecutorStartPromiseStartedAt ? getPromiseLatchAgeMs(coordinatorExecutorStartPromiseStartedAt) : 0,
            activeStorageContext: getActiveStorageContext()
                ? getStorageContextJournalDetails(getActiveStorageContext())
                : null,
            activeQueuedTabs: queueRuntime.listActiveQueuedTabIds(),
            schedulerBlockingQueuedExecutors: getSchedulerBlockingQueuedExecutorCount(),
            pausedQueuedOwners: queueRuntime.listPausedQueuedOwners(),
            queuedTabActions: queueRuntime.mapActivationIntents(action => ({...action})),
            pendingTabActions: queueRuntime.listPendingTabActionEntries().map(([tabId, action]) => [tabId, {...action}]),
            queuedTabMetadata: queueRuntime.listQueuedTabMetadataEntries().map(([tabId, metadata]) => [tabId, {...metadata}]),
            queuedActionSurfaceWindowId,
            queuedActionSurfaceAnchorTabId,
            queueLoadThrottle: {...queueLoadThrottle},
            constants: {
                STALE_BACKGROUND_OPENING_QUEUED_TAB_MS,
                STALE_ACTIVE_ACTION_QUEUED_TAB_MS,
                STALE_FOREGROUND_WAIT_QUEUED_TAB_MS,
                QUEUED_TAB_CREATE_TIMEOUT_MS,
                COORDINATOR_ACTIVE_JOB_MAX_MS,
                COORDINATOR_ACTIVE_ACTION_JOB_MAX_MS,
                STALE_CLOSE_REQUESTED_QUEUED_TAB_MS,
                COORDINATOR_JOB_MILESTONE_FLUSH_MS,
                SPACE_FEED_STORAGE_UPDATE_TIMEOUT_MS,
                COORDINATOR_ACTIVE_RECONCILE_STORAGE_UPDATE_TIMEOUT_MS,
                QUEUE_CRITICAL_STORAGE_UPDATE_TIMEOUT_MS,
                COORDINATOR_FAST_EXECUTOR_RESUME_TIMEOUT_MS,
                QUEUED_TAB_ACTION_CLAIM_NUDGE_TIMEOUT_MS,
                QUEUED_TAB_FILL_PROMISE_STALE_MS,
                QUEUED_TAB_IDLE_FILL_PROMISE_STALE_MS,
                COORDINATOR_RECONCILE_PROMISE_STALE_MS,
                COORDINATOR_IDLE_RECONCILE_PROMISE_STALE_MS,
                COORDINATOR_IDLE_EXECUTOR_START_PROMISE_STALE_MS,
                COORDINATOR_DETACHED_EXECUTOR_START_PROMISE_STALE_MS,
                COORDINATOR_QUEUE_WAL_SEGMENT_SOFT_SWITCH_AT,
                COORDINATOR_QUEUE_WAL_SEGMENT_HARD_LIMIT,
                COORDINATOR_QUEUE_WAL_CHECKPOINT_SWITCH_TIMEOUT_MS
            }
        }
    }
}
`

    function FakeDate(...args) {
        if(this instanceof FakeDate) {
            return args.length ? new Date(...args) : new Date(timers.now)
        }
        return new Date(timers.now).toString()
    }
    FakeDate.now = () => timers.now
    FakeDate.UTC = Date.UTC
    FakeDate.parse = Date.parse
    FakeDate.prototype = Date.prototype

    const module = {exports: {}}
    const context = {
        console,
        module,
        exports: module.exports,
        __filename: swPath,
        __dirname: path.dirname(swPath),
        setTimeout: timers.setTimeout,
        clearTimeout: timers.clearTimeout,
        Date: FakeDate,
        URL,
        URLSearchParams,
        Buffer,
        TextEncoder,
        TextDecoder,
        Promise,
        Map,
        Set,
        WeakMap,
        WeakSet,
        RegExp,
        Error,
        TypeError,
        Number,
        String,
        Boolean,
        Array,
        Object,
        JSON,
        Math
    }
    vm.createContext(context)
    const localRequire = createSharedRealmRequire(context, browser, baseRequire)(path.dirname(swPath))
    context.require = localRequire

    const wrapper = `(function(exports, require, module, __filename, __dirname) {\n${source}\n})`
    const compiled = new vm.Script(wrapper, {filename: swPath}).runInContext(context)
    compiled(module.exports, localRequire, module, swPath, path.dirname(swPath))

    return {
        browser,
        timers,
        sw: module.exports.__test,
        storage: browser.__storage
    }
}

module.exports = {
    createFakeBrowser,
    createFakeTimers,
    loadServiceWorkerHarness
}
