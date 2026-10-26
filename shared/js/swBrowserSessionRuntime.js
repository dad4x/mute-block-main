const {namespaceArea} = require('./storageNamespace')

// Browser-session marker and Quora-runtime-activation tracking extracted
// from sw.js (decomposition Slice 7). This is the "has this service worker
// observed the browser session before, and has it seen a live Quora tab
// yet" bookkeeping that gates whether queue-wakeup-metrics startup work and
// stored-work auto-resume are allowed to run before Quora is confirmed
// active.
//
// ensureBrowserSessionStartupMetricsReset and
// startQueueWakeupMetricsBackedStartupWork stayed behind in sw.js instead
// of moving here (unlike the plan's other 13 named functions) -- see the
// "left in sw.js" note in sw.js right above where they're defined for why.
// Short version: this module runs in a different V8 realm than sw.js under
// the test harness's vm sandbox (a plain `require()`, not sandboxed, same
// as every other extracted module), and those two functions' `.then()`
// chain calls into swQueueWakeupMetricsShape.js's ensureQueueWakeupMetricsLoaded
// -- itself *also* a plain `require()`'d module sharing this module's
// realm. Keeping the chain's first link (ensureBrowserSessionStartupMetricsReset's
// `Promise.resolve(false)`) in sw.js's realm preserves the one real
// vm-realm-to-plain-realm crossing (and its one extra microtask tick) that
// existed pre-slice; moving it here would have collapsed that crossing to
// zero (both links landing in the same plain realm) and silently shifted a
// race in test/swSynthetic.test.js's "stale queued fill promise is cleared
// so durable queue can resume" test (confirmed via a minimal repro:
// instrumenting the epoch id at each `pump.changed.clearedStaleFillPromise`
// increment showed two increments landing in two different metrics epochs
// pre-slice -- an epoch reset from the first real queue-wakeup-metrics load
// lands between them -- collapsing to the same epoch, i.e. one fewer tick
// of separation, once the chain no longer crosses realms). Production is
// unaffected either way (webpack bundles every module into one realm), but
// the test-visible reordering was real, so the two functions -- and the
// browserSessionStartupResetChecked/browserSessionStartupResetPromise
// state they alone touch -- stayed in sw.js. markQuoraRuntimeActivated
// calling startQueueWakeupMetricsBackedStartupWork from here is a plain
// (non-chained, `void`-discarded) function call, not a `.then()` link, so
// it doesn't reintroduce the issue.
//
// State ownership: quoraRuntimeActivated is read and/or written both by
// the functions moved here and by async orchestration functions that
// remain in sw.js (the coordinator-resume/reconcile scheduling core --
// still out of scope for this Part-1 sync-only slice), so it stays a `let`
// variable in sw.js and is threaded through as a get/set accessor pair in
// `deps.state`, matching the convention already used for
// queueWakeupMetrics/queueLoadThrottle in swQueueWakeupMetricsShape.js.
// coordinatorResumePromise / queuedTabFillPromise are read-only here
// (markQuoraRuntimeActivated only checks whether a resume/fill is already
// in flight before deciding whether to kick one off), so only getters are
// threaded in.
//
// Every Date.now() call found in the moved bodies (two session-marker
// timestamp writes) is threaded through as `now: () => Date.now()`, and
// the two setTimeout-based rearm schedulers thread `setTimeoutFn:
// setTimeout`, both per the decomposition plan's clock/environment-global
// note -- this module runs in a different V8 realm than sw.js under the
// test harness's vm sandbox, so bare `Date`/`setTimeout` references here
// would resolve to the real Node clock/timers instead of the harness's
// fake ones.
//
// scheduleStoredWorkRearmAfterServiceWorkerReload's *definition* moved
// here while its literal top-level *call* statement
// (`scheduleStoredWorkRearmAfterServiceWorkerReload()`) stays put in sw.js
// -- test/lib/swHarness.js regex-suppresses that exact call by source text
// during tests, and the regex matches call-site text regardless of where
// the function is defined. sw.js destructures this name (like every other
// function here) back onto its original bare identifier, so both the
// harness's regex and the call itself keep working unchanged.

function createBrowserSessionRuntime(deps = {}) {
    const {
        browser,
        now: getNow = () => Date.now(),
        setTimeoutFn = setTimeout
    } = deps
    const {
        BROWSER_SESSION_MARKER_KEY,
        QUORA_RUNTIME_ACTIVATED_SESSION_KEY,
        COORDINATOR_RESUME_ALARM_NAME,
        COORDINATOR_RECONCILE_ALARM_NAME,
        PERSISTENT_FAILED_RETRY_ALARM_NAME
    } = deps.constants || {}
    const {
        promiseWithTimeout,
        makeId,
        getExtensionVersion,
        pushQueueWakeupJournalEntry,
        incrementQueueWakeupMetric,
        scheduleQueuedWorkerActionSurfaceCleanup,
        resumeStoredWorkAfterQuoraActivation,
        startQueueWakeupMetricsBackedStartupWork,
        isQuoraRuntimeUrl,
        rearmStoredWorkAfterExtensionReload,
        rearmStoredWorkAfterServiceWorkerReload
    } = deps.handlers || {}
    const {
        getQuoraRuntimeActivated = () => false,
        setQuoraRuntimeActivated = () => {},
        getCoordinatorResumePromise = () => null,
        getQueuedTabFillPromise = () => null
    } = deps.state || {}

    function getBrowserSessionStorageArea() {
        if(browser.storage?.session) return namespaceArea(browser.storage.session)

        const chromeSession = globalThis.chrome?.storage?.session || null
        if(!chromeSession) return null

        return namespaceArea({
            get(defaults = {}) {
                return new Promise((resolve, reject) => {
                    chromeSession.get(defaults, result => {
                        const error = globalThis.chrome?.runtime?.lastError
                        if(error) {
                            reject(new Error(error.message || `${error}`))
                            return
                        }
                        resolve(result || {})
                    })
                })
            },
            set(payload = {}) {
                return new Promise((resolve, reject) => {
                    chromeSession.set(payload, () => {
                        const error = globalThis.chrome?.runtime?.lastError
                        if(error) {
                            reject(new Error(error.message || `${error}`))
                            return
                        }
                        resolve()
                    })
                })
            }
        })
    }

    function hasBrowserSessionStorage() {
        const area = getBrowserSessionStorageArea()
        return !!(
            area &&
            typeof area.get === 'function' &&
            typeof area.set === 'function'
        )
    }

    function rememberBrowserSessionMarker(reason = 'observed') {
        const area = getBrowserSessionStorageArea()
        if(!area || typeof area.set !== 'function') return Promise.resolve(false)

        return promiseWithTimeout(
            area.set({
                [BROWSER_SESSION_MARKER_KEY]: {
                    id: makeId('browser-session'),
                    reason,
                    extensionVersion: getExtensionVersion(),
                    observedAt: getNow()
                }
            }),
            1000,
            'browser session marker write'
        )
            .then(() => true)
            .catch(() => false)
    }

    function rememberQuoraRuntimeActivation(reason = 'quora-observed') {
        const area = getBrowserSessionStorageArea()
        if(!area || typeof area.set !== 'function') return Promise.resolve(false)

        return promiseWithTimeout(
            area.set({
                [QUORA_RUNTIME_ACTIVATED_SESSION_KEY]: {
                    active: true,
                    reason,
                    extensionVersion: getExtensionVersion(),
                    observedAt: getNow()
                }
            }),
            1000,
            'quora runtime activation marker write'
        )
            .then(() => true)
            .catch(() => false)
    }

    function forgetQuoraRuntimeActivation(reason = 'quora-runtime-reset') {
        setQuoraRuntimeActivated(false)
        const area = getBrowserSessionStorageArea()
        if(!area || typeof area.set !== 'function') return Promise.resolve(false)

        return promiseWithTimeout(
            area.set({[QUORA_RUNTIME_ACTIVATED_SESSION_KEY]: null}),
            1000,
            'quora runtime activation marker clear'
        )
            .then(() => {
                pushQueueWakeupJournalEntry({
                    kind: 'state-change',
                    name: 'quora-runtime-activation-cleared',
                    reason,
                    result: 'state-changed'
                })
                return true
            })
            .catch(() => false)
    }

    function clearSchedulerAlarms(reason = 'clear-scheduler-alarms') {
        if(!browser.alarms?.clear) return Promise.resolve(false)

        return Promise.all([
            browser.alarms.clear(COORDINATOR_RESUME_ALARM_NAME).catch(() => false),
            browser.alarms.clear(COORDINATOR_RECONCILE_ALARM_NAME).catch(() => false),
            browser.alarms.clear(PERSISTENT_FAILED_RETRY_ALARM_NAME).catch(() => false)
        ])
            .then(results => {
                pushQueueWakeupJournalEntry({
                    kind: 'state-change',
                    name: 'scheduler-alarms-cleared',
                    reason,
                    result: results.some(Boolean) ? 'state-changed' : 'no-op'
                })
                return results.some(Boolean)
            })
            .catch(() => false)
    }

    function markQuoraRuntimeActivated(reason = 'quora-observed') {
        if(getQuoraRuntimeActivated()) {
            void rememberQuoraRuntimeActivation(reason)
            return false
        }
        setQuoraRuntimeActivated(true)
        incrementQueueWakeupMetric('runtime.quoraActivated')
        pushQueueWakeupJournalEntry({
            kind: 'state-change',
            name: 'quora-runtime-activated',
            reason,
            result: 'state-changed'
        })
        void rememberQuoraRuntimeActivation(reason)
        void startQueueWakeupMetricsBackedStartupWork({force: true})
        scheduleQueuedWorkerActionSurfaceCleanup('quora-runtime-activated-idle', 5000)
        if(getCoordinatorResumePromise() || getQueuedTabFillPromise()) {
            incrementQueueWakeupMetric('runtime.quoraActivatedResumeAlreadyActive')
            return true
        }
        void resumeStoredWorkAfterQuoraActivation(reason).catch(() => null)
        return true
    }

    function markQuoraRuntimeActivatedFromRequest(request = {}, sender = {}, reason = 'message') {
        const urls = [
            sender?.tab?.url,
            request?.url,
            request?.profileHref,
            request?.href,
            request?.targetProfileHref,
            request?.requestedUrl,
            request?.sourcePageUrl,
            request?.source?.pageUrl,
            request?.run?.sourcePageUrl
        ]
        if(Array.isArray(request?.items)) {
            for(const item of request.items) {
                urls.push(
                    item?.url,
                    item?.href,
                    item?.profileHref,
                    item?.targetProfileHref,
                    item?.requestedUrl,
                    item?.sourcePageUrl
                )
            }
        }
        if(Array.isArray(request?.urls)) urls.push(...request.urls)
        if(Array.isArray(request?.profileHrefs)) urls.push(...request.profileHrefs)
        if(urls.some(isQuoraRuntimeUrl)) {
            return markQuoraRuntimeActivated(reason)
        }
        return false
    }

    function makeQuoraRuntimeNotActivatedResult(reason = 'quora-runtime-not-activated') {
        return {
            recovered: false,
            reason,
            requiresQuoraVisit: true,
            alarmCreated: false,
            fallbackScheduled: false,
            resumeScheduled: false,
            reconcileScheduled: false,
            scheduledOnly: true
        }
    }

    function scheduleStoredWorkRearmAfterExtensionReload(reason = 'extension-updated') {
        setTimeoutFn(() => {
            void rearmStoredWorkAfterExtensionReload(reason).catch(() => null)
        }, 1000)
    }

    function scheduleStoredWorkRearmAfterServiceWorkerReload(reason = 'service-worker-reload') {
        setTimeoutFn(() => {
            void rearmStoredWorkAfterServiceWorkerReload(reason).catch(() => null)
        }, 1000)
    }

    function normalizeObjectNumberMap(value = null) {
        const result = {}
        for(const [key, raw] of Object.entries(value && typeof value === 'object' ? value : {})) {
            const normalizedKey = `${key || ''}`.trim()
            const number = Number(raw) || 0
            if(normalizedKey && Number.isFinite(number)) result[normalizedKey] = number
        }
        return result
    }

    function normalizeQueueWakeupPhaseMap(value = null) {
        const result = {}
        for(const [key, raw] of Object.entries(value && typeof value === 'object' ? value : {})) {
            const name = `${key || ''}`.trim()
            if(!name || !raw || typeof raw !== 'object') continue
            const count = Math.max(0, Number.parseInt(raw.count, 10) || 0)
            const totalMs = Math.max(0, Number(raw.totalMs) || 0)
            result[name] = {
                count,
                totalMs,
                lastMs: Math.max(0, Number(raw.lastMs) || 0),
                maxMs: Math.max(0, Number(raw.maxMs) || 0),
                lastAt: Number.parseInt(raw.lastAt, 10) || 0
            }
        }
        return result
    }

    return {
        getBrowserSessionStorageArea,
        hasBrowserSessionStorage,
        rememberBrowserSessionMarker,
        rememberQuoraRuntimeActivation,
        forgetQuoraRuntimeActivation,
        clearSchedulerAlarms,
        markQuoraRuntimeActivated,
        markQuoraRuntimeActivatedFromRequest,
        makeQuoraRuntimeNotActivatedResult,
        scheduleStoredWorkRearmAfterExtensionReload,
        scheduleStoredWorkRearmAfterServiceWorkerReload,
        normalizeObjectNumberMap,
        normalizeQueueWakeupPhaseMap
    }
}

module.exports = {
    createBrowserSessionRuntime
}
