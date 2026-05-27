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

function loadServiceWorkerHarness(options = {}) {
    const repoRoot = path.resolve(__dirname, '..', '..')
    const swPath = path.join(repoRoot, 'shared/js/sw.js')
    const timers = options.timers || createFakeTimers(options.now || 0)
    const browser = options.browser || createFakeBrowser(options.storage || {})
    const baseRequire = createRequire(swPath)
    let source = fs.readFileSync(swPath, 'utf8')

    if(!options.runStartupWork) {
        source = source.replace(/\nvoid startQueueWakeupMetricsBackedStartupWork\(\)\s*$/, '\n')
    }
    source += `

module.exports.__test = {
    applyCoordinatorRowEvent,
    applyCoordinatorRowEvents,
    buildCoordinatorQueueView,
    buildQueueWakeupMetricsView,
    coordinatorAuthority,
    enqueueSpaceFeedStorageUpdate,
    enqueueExistingExecutorForCoordinator,
    kickCoordinatorQueueResume,
    metricStorageGet,
    metricStorageSet,
    recoverStoredCoordinatorWork,
    repairCoordinatorStorageFromProgress,
    recordCoordinatorJobProgress,
    getCoordinatorQueueAccounting,
    refreshCoordinatorQueueViewForDashboard,
    refreshQueueWakeupMetricsViewForDashboard,
    recordDeferredCoordinatorJobMilestone,
    resetQueueWakeupMetricsEpochAfterLoad,
    rollbackFailedQueuedTabOpen,
    transitionCoordinatorItemForQueuedTab,
    requestCoordinatorActionLease,
    heartbeatCoordinatorActionLease,
    releaseCoordinatorActionLease,
    releaseCoordinatorActionLeaseForTab,
    runCoordinatorAuthorityReconcileActions,
    runCoordinatorReconcileTick,
    resumeCoordinatorQueueExecution,
    resumeCoordinatorQueueExecutionOnce,
    restoreCoordinatorPageForStoredWork,
    runStoredWorkRepairTick,
    saveCoordinatorState,
    scheduleStoredWorkRepair,
    settleTerminalCoordinatorItems,
    startQueueWakeupMetricsBackedStartupWork,
    syncCoordinatorProgressRecords,
    sweepStaleQueuedTabs,
    switchCoordinatorAuthorityQueueWalCheckpoint,
    terminalizeCoordinatorKeyOnlyItem,
    terminalizeActiveCoordinatorNonProfileLanding,
    __testAddProvisionalQueuedTab(tabId, metadata = {}, action = null) {
        activeQueuedTabs.add(tabId)
        setQueuedTabMetadata(tabId, metadata)
        pendingTabActions.set(tabId, action || {
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
    __testAddQueuedAction(action = {}) {
        queuedTabActions.push({
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
        })
    },
    __testSetCoordinatorAuthorityShadowWalStore(value) {
        coordinatorAuthorityShadowWalStore = value
    },
    __testSetProgressShadowWalStore(value) {
        progressShadowWalStore = value
    },
    state() {
        return {
            storedWorkRepairDueAt,
            hasStoredWorkRepairTimeout: !!storedWorkRepairTimeout,
            storedWorkRepairBackoffLevel,
            storedWorkRepairBackoffUntil,
            coordinatorQueueResumeDueAt,
            hasCoordinatorQueueResumeTimeout: !!coordinatorQueueResumeTimeout,
            queueWakeupCounters: {...getQueueWakeupMetricEpoch().counters},
            profileNukeProgress: {...profileNukeProgress},
            coordinatorAuthorityShadowWalStore: JSON.parse(JSON.stringify(coordinatorAuthorityShadowWalStore)),
            progressShadowWalStore: JSON.parse(JSON.stringify(progressShadowWalStore)),
            coordinatorQueueWal: JSON.parse(JSON.stringify(coordinatorAuthority.current().stored?.mbCoordinatorQueueWal || null)),
            spaceFeedStorageUpdateDepth,
            abandonedSpaceFeedStorageUpdates: abandonedSpaceFeedStorageUpdates.size,
            activeQueuedTabs: Array.from(activeQueuedTabs),
            queuedTabActions: queuedTabActions.map(action => ({...action})),
            queuedTabMetadata: Array.from(queuedTabMetadata.entries()).map(([tabId, metadata]) => [tabId, {...metadata}]),
            queueLoadThrottle: {...queueLoadThrottle},
            constants: {
                STALE_BACKGROUND_OPENING_QUEUED_TAB_MS,
                STALE_ACTIVE_ACTION_QUEUED_TAB_MS,
                STALE_FOREGROUND_WAIT_QUEUED_TAB_MS,
                COORDINATOR_ACTIVE_JOB_MAX_MS,
                COORDINATOR_ACTIVE_ACTION_JOB_MAX_MS,
                STALE_CLOSE_REQUESTED_QUEUED_TAB_MS,
                SPACE_FEED_STORAGE_UPDATE_TIMEOUT_MS
            }
        }
    }
}
`

    function localRequire(request) {
        if(request === 'webextension-polyfill') return browser
        return baseRequire(request)
    }

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
        require: localRequire,
        __filename: swPath,
        __dirname: path.dirname(swPath),
        setTimeout: timers.setTimeout,
        clearTimeout: timers.clearTimeout,
        Date: FakeDate,
        URL,
        URLSearchParams,
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

    const wrapper = `(function(exports, require, module, __filename, __dirname) {\n${source}\n})`
    const compiled = vm.runInNewContext(wrapper, context, {filename: swPath})
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
