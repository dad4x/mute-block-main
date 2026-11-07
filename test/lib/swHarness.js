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

const {
    PROFILE_NUKE_PROGRESS_SHARD_PREFIX,
    PROFILE_NUKE_PROGRESS_VIEW_KEY,
    QUEUE_WAKEUP_METRICS_KEY,
    QUEUE_WAKEUP_METRICS_VIEW_KEY,
    STORAGE_LAYOUT_PREFIX
} = require('../../shared/js/storageKeys')
const {WORKER_WINDOW_FOREGROUND_MODES} = require('../../shared/js/swprefs')

// Decision 31: profile progress (the view and the shards) is held in session storage, never on disk. A progress key in a seed goes to
// the session copy, unless options.progressOnDisk is set (the legacy-copy cleanup test seeds the old disk copy that way).
function isProfileProgressStorageKey(key = '') {
    return key === PROFILE_NUKE_PROGRESS_VIEW_KEY || key.startsWith(PROFILE_NUKE_PROGRESS_SHARD_PREFIX)
}

// Owner decision 26 Oct: the queue-wakeup metrics record and its dashboard view are held in session storage, never on disk.
function isQueueWakeupMetricsStorageKey(key = '') {
    return key === QUEUE_WAKEUP_METRICS_KEY || key === QUEUE_WAKEUP_METRICS_VIEW_KEY
}

// Every key that lives in session storage, as opposed to the disk copy.
function isSessionOnlyStorageKey(key = '') {
    return isProfileProgressStorageKey(key) || isQueueWakeupMetricsStorageKey(key)
}

// The storage a test reads for the worker, under plain names: a test reads and writes `storage.mbCoordinatorRuns`, and the raw areas
// hold `v1.6.mbCoordinatorRuns`. Disk keys come from the local copy and progress and metrics keys from the session copy. Reads, writes
// and deletes of those keys go to the session copy. Stored names outside this layout are not shown.
function makeWorkerStorageView(localStorage, sessionStorage, layoutPrefix = '') {
    const toStored = key => typeof key === 'string' ? `${layoutPrefix}${key}` : key
    const toPlain = name => typeof name === 'string' && name.startsWith(layoutPrefix) ? name.slice(layoutPrefix.length) : null
    const isProgressKey = key => typeof key === 'string' && isSessionOnlyStorageKey(key)
    return new Proxy(localStorage, {
        get: (target, key) => isProgressKey(key) ? sessionStorage[toStored(key)] : target[toStored(key)],
        set(target, key, value) {
            if(isProgressKey(key)) sessionStorage[toStored(key)] = value
            else target[toStored(key)] = value
            return true
        },
        has: (target, key) => isProgressKey(key) ? toStored(key) in sessionStorage : toStored(key) in target,
        deleteProperty(target, key) {
            if(isProgressKey(key)) delete sessionStorage[toStored(key)]
            else delete target[toStored(key)]
            return true
        },
        ownKeys: target => [
            ...Object.keys(target).map(toPlain).filter(key => key !== null && !isProgressKey(key)),
            ...Object.keys(sessionStorage).map(toPlain).filter(key => key !== null && isSessionOnlyStorageKey(key))
        ],
        getOwnPropertyDescriptor(target, key) {
            if(!isProgressKey(key)) return Object.getOwnPropertyDescriptor(target, toStored(key))
            const descriptor = Object.getOwnPropertyDescriptor(sessionStorage, toStored(key))
            return descriptor ? {...descriptor, configurable: true} : undefined
        }
    })
}

function createFakeBrowser(initialStorage = {}, options = {}) {
    // The raw areas hold stored names (the layout prefix plus the plain name, storageNamespace.js). A seed is written under plain names,
    // so the seed is stored under the prefix here; progress keys go to the session copy unless options.progressOnDisk is set.
    const layoutPrefix = options.layoutPrefix ?? ''
    const storage = {}
    const sessionStorage = {}
    for(const [key, value] of Object.entries(clone(initialStorage) || {})) {
        const storedName = `${layoutPrefix}${key}`
        const onSession = isQueueWakeupMetricsStorageKey(key) || (options.progressOnDisk !== true && isProfileProgressStorageKey(key))
        if(onSession) sessionStorage[storedName] = value
        else storage[storedName] = value
    }
    // Stored names as they are (a copy of an earlier run's raw storage, or keys another layout wrote): not prefixed here.
    for(const [storedName, value] of Object.entries(clone(options.rawStorage) || {})) storage[storedName] = value
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
                // get(null) reads every key, as chrome.storage does.
                if(defaults === null) return clone(targetStorage)
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
            async clear() {
                for(const key of Object.keys(targetStorage)) delete targetStorage[key]
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
                // As in the browser, a remove resolves without waiting for the change listeners.
                void storageOnChanged.emit(changes, areaName)
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
            onSuspend: makeEvent(),
            // The erase reloads the extension. The harness does not restart; a test that wants to see the reload replaces this.
            reload() {},
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
        action: {
            badgeText: '',
            badgeBackgroundColor: '',
            title: '',
            async setBadgeText(details = {}) {
                this.badgeText = details.text || ''
            },
            async setBadgeBackgroundColor(details = {}) {
                this.badgeBackgroundColor = details.color || ''
            },
            async setTitle(details = {}) {
                this.title = details.title || ''
            }
        },
        tabs: {
            onRemoved: makeEvent(),
            onUpdated: makeEvent(),
            async query(queryInfo = {}) {
                const allTabs = Array.from(tabs.values())
                let filtered = allTabs
                if(queryInfo?.windowId !== undefined && queryInfo?.windowId !== null) {
                    const windowId = Number.parseInt(queryInfo.windowId, 10)
                    filtered = filtered.filter(tab => tab.windowId === windowId)
                }
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
            onBeforeRedirect: makeEvent(),
            onBeforeRequest: makeEvent(),
            onCompleted: makeEvent(),
            onErrorOccurred: makeEvent()
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

function createSharedRealmRequire(context, browser, baseRequire, layoutPrefix = '') {
    const moduleCache = new Map() // absolutePath -> {exports}
    // The storage key names are the real module, with this harness's layout prefix (storageNamespace.js reads the prefix from here).
    const storageKeysPath = path.resolve(__dirname, '../../shared/js/storageKeys.js')
    const storageKeysForLayout = {...require('../../shared/js/storageKeys'), STORAGE_LAYOUT_PREFIX: layoutPrefix}

    function requireFrom(callerDir) {
        return function localRequire(request) {
            if(request === 'webextension-polyfill') return browser
            if(!request.startsWith('.')) return baseRequire(request)

            let resolvedPath = path.resolve(callerDir, request)
            if(!resolvedPath.endsWith('.js')) resolvedPath += '.js'
            if(resolvedPath === storageKeysPath) return storageKeysForLayout

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
    // The layout prefix of this harness's stored keys. The default is no prefix: the behavioural suite runs on plain names. A test
    // that checks the layout passes layoutPrefix (storageKeys STORAGE_LAYOUT_PREFIX), and then the worker writes prefixed keys only.
    const layoutPrefix = options.layoutPrefix ?? ''
    const browser = options.browser || createFakeBrowser(options.storage || {}, {progressOnDisk: options.progressOnDisk, layoutPrefix, rawStorage: options.rawStorage})
    const baseRequire = createRequire(swPath)
    let source = `let __testHarnessDeactivated = false;\nlet __testCoordinatorExecutorStartThrow = null;\nlet __testCoordinatorExecutorStartResult = null;\n${fs.readFileSync(swPath, 'utf8')}`

    if(!options.runStartupWork) {
        source = source
            .replace(/\nvoid startQueueWakeupMetricsBackedStartupWork\(\)/, '\n')
            .replace(/\nvoid scheduleStoredWorkRearmAfterStartupHydrate\(\)/, '\n')
    }
    if(options.disableQueueWakeupMetricsFlush === true) {
        source = source.replace(
            'function scheduleQueueWakeupMetricsFlush() {\n    queueWakeupMetricsDirty = true',
            'function scheduleQueueWakeupMetricsFlush() {\n    queueWakeupMetricsDirty = false\n    return'
        )
    }
    if(options.disableQueueWalCheckpointSwitch === true) {
        const needle = "function scheduleCoordinatorQueueWalCheckpointSwitch(reason = 'segment-soft-threshold', committedSegments = 0) {\n"
        if(!source.includes(needle)) {
            throw new Error('disableQueueWalCheckpointSwitch patch target not found in sw.js -- signature drifted, update swHarness.js')
        }
        source = source.replace(
            needle,
            "function scheduleCoordinatorQueueWalCheckpointSwitch(reason = 'segment-soft-threshold', committedSegments = 0) {\n    return null\n"
        )
    }
    if(options.fastExecutorResumeTimeoutMs) {
        const timeoutMs = Math.max(1000, Number.parseInt(options.fastExecutorResumeTimeoutMs, 10) || 0)
        source = source.replace(
            'const COORDINATOR_FAST_EXECUTOR_RESUME_TIMEOUT_MS = 180000',
            `const COORDINATOR_FAST_EXECUTOR_RESUME_TIMEOUT_MS = ${timeoutMs}`
        )
    }
    source = source.replace(
        'async function enqueueExistingExecutorForCoordinator(items = [], coordinator = {}, options = {}) {\n    clearStaleCoordinatorExecutorStartPromise',
        'async function enqueueExistingExecutorForCoordinator(items = [], coordinator = {}, options = {}) {\n    if(__testCoordinatorExecutorStartThrow) {\n        const error = __testCoordinatorExecutorStartThrow\n        __testCoordinatorExecutorStartThrow = null\n        throw error\n    }\n    if(__testCoordinatorExecutorStartResult) {\n        const result = __testCoordinatorExecutorStartResult\n        __testCoordinatorExecutorStartResult = null\n        return result\n    }\n    clearStaleCoordinatorExecutorStartPromise'
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
    source += `

module.exports.__test = {
    archiveTerminalCoordinatorRow,
    startDebugResumeLimit,
    enforceDebugResumeLimit,
    handleDebugResumeLimitAlarm,
    getDebugResumeLimitStatus,
    orderQueuedItemsForDrain,
    noteDebugResumeTargetFinished,
    applyCoordinatorRowEvent,
    applyCoordinatorRowEvents,
    buildCoordinatorQueueView,
    buildCoordinatorQueueViewFromDashboardSnapshot,
    mergeCoordinatorQueueViewTimingCache,
    setCoordinatorQueueWalResidentStoreCache,
    getResidentCoordinatorQueueWalPhysicalStoredSupplement,
    buildCoordinatorContentQueueIndex,
    coordinatorRawQueueNormalizationChangedRows,
    coordinatorStorageAdapter,
    normalizeRawCoordinatorQueueForReconcileFallback,
    getOwnedNukeStatus,
    buildQueueWakeupMetricsView,
    classifyCoordinatorExecutorState,
    coordinatorAuthority,
    enqueueSpaceFeedStorageUpdate,
    enqueueExistingExecutorForCoordinator,
    enqueueExistingExecutorForCoordinatorOnce,
    fillQueuedTabsOnce,
    readResidentDerivedQueueIndex,
    getLegacyContentIndexCleanupNames,
    retireLegacyContentIndexKeys,
    getContentPageCoordinatorState,
    recordDirectProfileProgressFromRequest,
    cancelCoordinatorCurrentWork,
    pauseCoordinatorNukes,
    // Test-only hooks for the executor-start token and the pause guard (review-2 S2-1, S2-2, S3-1). Getters read the live binding.
    resetCoordinatorExecutorStartPromiseAfterTimeout: reason => persistentRetryExecutorTimers.resetCoordinatorExecutorStartPromiseAfterTimeout(reason),
    getCoordinatorExecutorStartTokenForTest: () => coordinatorExecutorStartToken,
    getQueuedTabConcurrencyForTest: () => queuedTabConcurrency,
    getCoordinatorPauseRequestedForTest: () => coordinatorPauseRequested,
    getCoordinatorQueueViewTimingCacheForTest: () => coordinatorQueueViewTimingCache,
    clearCoordinatorTerminalStats,
    runCoordinatorExecutorApplyPhase,
    buildQueuedTabOpenEffectPlan,
    applyQueuedTabOpenRuntimeEffect,
    confirmQueuedTabOpenDurableActiveEffect,
    rollbackFailedQueuedTabOpen,
    kickCoordinatorQueueResume,
    metricStorageGet,
    metricStorageSet,
    recoverStoredCoordinatorWork,
    ensureQueuedTabContentScript,
    handleQueuedTabContentScriptEnsureResult,
    nudgeQueuedTabActionClaim,
    nudgeQueuedTabActionClaimWithRetries,
    ensureProfileNukeProgressReady,
    saveProfileNukeProgressRowProjection,
    rebuildContentPageStateProjectionFromCurrentState,
    deleteProfileNukeProgressRowProjection,
    reconcileCoordinatorStorage,
    recordCoordinatorJobProgress,
    recordCoordinatorJobProgressRecords,
    recordFlightRecorderEvent,
    getFlightRecorder,
    getFlightRecorderSnapshot,
    createOwnedTabInQueuedWorkerActionSurface,
    getOrCreateQueuedWorkerActionSurface,
    getCoordinatorWhyNotRunning,
    getStorageUpdateQueueSnapshot,
    getRuntimeSurfaceForCoordinatorItem,
    buildRuntimeSurfaceIndex,
    getCoordinatorResumeMaxConcurrent,
    setTargetQueuedTabConcurrency,
    setWorkerWindowForegroundMode,
    startCoordinatorWorkSession,
    endCoordinatorWorkSession,
    isCoordinatorPausedInStorage,
    readResidentCoordinatorStored,
    getTargetQueuedTabConcurrency: () => targetQueuedTabConcurrency,
    summarizeCoordinatorActualBlockTiming,
    summarizeCoordinatorAlreadyBlockedTiming,
    summarizeCoordinatorActivationHandoffTiming,
    recordCoordinatorPauseTransition,
    recordQueueLoadThrottleTransition,
    queueRuntime,
    maybeWarnCoordinatorStorageUpdateQueueStall,
    setCoordinatorWriteQueueBacklogAlertBadge,
    getCoordinatorWriteQueueBacklogAlertActive() {
        return coordinatorWriteQueueBacklogAlertActive
    },
    recoverQueuedAuthorityLiveTabAfterMaterializationFailure,
    isQueuedTabRetryBudgetReleaseReason,
    getExhaustedRolledBackQueuedTabTerminalError,
    shouldAdvanceRolledBackQueuedTabBeforeOpen,
    recordQueuedTabMetadataMilestone,
    getCoordinatorQueueAccounting,
    refreshCoordinatorQueueViewForDashboard,
    refreshCoordinatorRunsViewForDashboard,
    refreshCoordinatorDashboardViewsForDashboard,
    loadCoordinatorOutliersRecord,
    loadCoordinatorDashboardAuthoritySnapshot,
    loadCoordinatorQueueRowFromStorage,
    loadCoordinatorQueueRowsFromStorage,
    rebuildCoordinatorQueueMirrorFromDisk,
    readCoordinatorQueueRowsFromMirror,
    closeTerminalOwnedProfileTabs,
    scheduleTerminalOwnedTabOrphanSweep,
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
    findCompletedWorkRowByKey,
    getRecentCompletedWorkRows,
    closeQueuedWorkerActionSurfaceIfIdle,
    terminalizeCoordinatorKeyOnlyItem,
    terminalizeActiveCoordinatorNonProfileLanding,
    terminalizeActiveCoordinatorItemFromBlockedLiveTab,
    terminalizeExhaustedRolledBackQueuedCoordinatorItem,
    terminalizeExhaustedRolledBackQueuedCoordinatorItems,
    __testResetFlightRecorder: require('./swflightRecorder').__testResetFlightRecorder,
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
    // A tab the queue made (what the queue does when it opens a worker-window tab). Tabs a test creates without this are the user's.
    __testRecordQueueCreatedWorkerTab(tabId) {
        registerQueueCreatedWorkerTab(tabId)
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
    __testSetCoordinatorExecutorStartResult(result) {
        __testCoordinatorExecutorStartResult = result
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
            pauseWindows: [...(getQueueWakeupMetricEpoch().pauseWindows || [])],
            queueLoadThrottleWindows: [...(getQueueWakeupMetricEpoch().queueLoadThrottleWindows || [])],
            profileNukeProgress: {...profileNukeProgress},
            // The resident stored copy, not current(): a counters snapshot must still read after a failed hydrate (D4 guard).
            coordinatorQueueWal: JSON.parse(JSON.stringify(coordinatorAuthority.residentStored()?.mbCoordinatorQueueWal || null)),
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
    const localRequire = createSharedRealmRequire(context, browser, baseRequire, layoutPrefix)(path.dirname(swPath))
    context.require = localRequire

    const wrapper = `(function(exports, require, module, __filename, __dirname) {\n${source}\n})`
    const compiled = new vm.Script(wrapper, {filename: swPath}).runInContext(context)
    compiled(module.exports, localRequire, module, swPath, path.dirname(swPath))

    // The worker-window foreground mode is the worker's stored preference. A test passes workerWindowForegroundMode to choose one.
    // Otherwise, when the test stores no mode, the synthetic focus assertions run in 'focus', the mode they were written against.
    const pinnedWorkerWindowForegroundMode = options.workerWindowForegroundMode ||
        (options.storage?.workerWindowForegroundMode === undefined ? 'focus' : null)
    if(pinnedWorkerWindowForegroundMode) {
        if(!WORKER_WINDOW_FOREGROUND_MODES.includes(pinnedWorkerWindowForegroundMode)) {
            throw new Error(`unknown workerWindowForegroundMode: ${pinnedWorkerWindowForegroundMode}`)
        }
        module.exports.__test.setWorkerWindowForegroundMode(pinnedWorkerWindowForegroundMode)
    }

    registerSeededQueueTabs(browser, module.exports.__test)

    return {
        browser,
        timers,
        sw: module.exports.__test,
        storage: makeWorkerStorageView(browser.__storage, browser.__sessionStorage, layoutPrefix)
    }
}

// Profile tabs a test has already put in the browser when the worker loads are the queue's tabs, as the tests have always
// assumed. A tab marked userTab: true is the user's and is left alone. Tabs a test opens after the load are registered by
// the test itself (sw.__testRecordQueueCreatedWorkerTab).
function registerSeededQueueTabs(browser, sw) {
    for(const tab of browser.__tabs.values()) {
        if(tab.userTab === true) continue
        if(/^https:\/\/[^/]*quora\.com\/profile\//.test(tab.url || '')) sw.__testRecordQueueCreatedWorkerTab(tab.id)
    }
}

module.exports = {
    createFakeBrowser,
    createFakeTimers,
    loadServiceWorkerHarness
}
