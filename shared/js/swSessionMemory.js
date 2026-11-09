const {namespaceArea} = require('./storageNamespace')

// Thin abstraction over chrome.storage.session, used as this extension's
// non-volatile-across-service-worker-restarts shared memory: in-memory (no
// disk cost), survives exactly the restarts a plain module-level `let`
// doesn't, and clears only when the browser session itself ends.
//
// MV3 evicts an idle service worker far more often than most state in this
// codebase originally assumed (confirmed live: up to 17 restarts in one
// ~79-minute session) -- several call sites independently reinvented the
// same "load once at startup, keep a resident in-memory copy, write back
// fire-and-forget on change" shape to cope with that
// (coordinatorQueueViewTimingCache, coordinatorQueueViewDiskWriteThrottleState
// in sw.js, both predating this module). As session storage sees more use
// as general cross-restart memory, new call sites should use this instead
// of re-deriving that boilerplate per key.
function createSessionMemoryStore(deps = {}) {
    const {browser} = deps

    async function loadSessionValue(key, defaults = null) {
        if(typeof browser?.storage?.session?.get !== 'function') return defaults
        try {
            const stored = await namespaceArea(browser.storage.session).get({[key]: defaults})
            return stored?.[key] !== undefined ? stored[key] : defaults
        }
        catch {
            return defaults
        }
    }

    function setSessionValue(key, value) {
        if(typeof browser?.storage?.session?.set !== 'function') return Promise.resolve(false)
        return namespaceArea(browser.storage.session).set({[key]: value}).then(() => true).catch(() => false)
    }

    // A resident cell: synchronous reads of a value loaded once from
    // session storage (via `load()`, called at startup), with `set()`
    // updating the resident copy immediately and mirroring it back to
    // session storage fire-and-forget. Every check against the cell stays
    // synchronous -- no await, no added latency on a hot path -- matching
    // the two pre-existing call sites this generalizes.
    function createSessionMemoryCell(key, defaults = null) {
        let value = defaults
        let loaded = false

        async function load() {
            value = await loadSessionValue(key, defaults)
            loaded = true
            return value
        }

        function get() {
            return value
        }

        function set(nextValue) {
            value = nextValue
            void setSessionValue(key, nextValue)
        }

        function isLoaded() {
            return loaded
        }

        return {
            load,
            get,
            set,
            isLoaded
        }
    }

    return {
        loadSessionValue,
        setSessionValue,
        createSessionMemoryCell
    }
}

module.exports = {
    createSessionMemoryStore
}
