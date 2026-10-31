// Owned-tab lifecycle bookkeeping extracted from sw.js (decomposition
// Slice 33, part 1 of 2): getErrorPageUrl, serializeOwnedTabIdsByParent,
// rebuildOwningParentByChild, schedulePersistOwnedTabIdsByParent,
// sendTabMessage, registerOwnedTab, and unregisterOwnedTab.
//
// markQueuedTabClosing and scheduleOwnedBlockedProfileSweep, textually
// interleaved in this same source-text cluster, are deliberately left
// resident in sw.js: markQueuedTabClosing builds a `.catch()` chain into
// resident async recordQueuedTabMetadataMilestone, and
// scheduleOwnedBlockedProfileSweep builds a `.then()/.catch()` chain into
// resident async sweepOwnedBlockedProfileTabs -- both the same class of
// realm-crossing risk documented in architecture.md's Slice-7 refinement
// and applied identically in Slice 32b to scheduleQueuedWorkerActionSurfaceCleanup.
// Moving either would turn a same-realm call into a genuine new vm/require()
// realm crossing on every invocation. schedulePersistOwnedTabIdsByParent,
// by contrast, only ever `void`-discards its call into resident async
// persistOwnedTabIdsByParent with no `.then()`/`.catch()`/`await` of its
// own -- a plain fire-and-forget, not a chain -- so it moves safely, and
// sendTabMessage's `.catch()` reaches into the host `browser` API (passed
// through as a plain dep), not into another require()'d module, which
// Slice 27 established carries no realm-crossing risk either.
//
// Construction-order finding: registerOwnedTab is eagerly referenced in
// queuedForegroundLeaseRuntime's own construction-call `handlers` object
// literal (sw.js, decomposition Slice 32a), well before this cluster's old
// source-text position (~24304-24439). A hoisted `function` declaration is
// visible throughout its enclosing scope; a `const` destructured from a
// factory call is in the temporal dead zone until that line executes -- so
// this module must construct before that reference, i.e. before
// queuedForegroundLeaseRuntime. It constructs immediately after
// activationGuardRuntime's destructure, using normalizeOwnedParentId
// (tabIdUtils) and queueRuntime, both already available bare consts by
// that point. persistOwnedTabIdsByParent is still a plain hoisted async
// function declaration further below (out of this slice's scope, per the
// Promise-chain caution above) and is threaded through directly -- hoisted
// declarations work from any point in the enclosing scope either way.
//
// State: the module-level `persistOwnedTabIdsTimeout` timeout handle in
// sw.js is threaded through as a getter/setter pair
// (state.getPersistOwnedTabIdsTimeout/state.setPersistOwnedTabIdsTimeout)
// rather than owned outright by this module, since it stays a bare sw.js
// `let` for now. setTimeout/clearTimeout are threaded through as
// setTimeoutFn/clearTimeoutFn per the queuedTabOpenUrlCommitHelpers
// precedent, so the test harness's fake timers are used rather than the
// real Node ones.
//
// None of these seven moved bodies read Date.now() or any other
// environment global, so this module needs no clock dependency.

function createOwnedTabLifecycle(deps = {}) {
    const {browser} = deps
    const {
        queueRuntime,
        normalizeOwnedParentId,
        persistOwnedTabIdsByParent,
        setTimeoutFn,
        clearTimeoutFn,
        recordFlightRecorderEvent = () => {}
    } = deps.handlers || {}
    const {
        getPersistOwnedTabIdsTimeout,
        setPersistOwnedTabIdsTimeout
    } = deps.state || {}

    function getErrorPageUrl(url = '') {
        const value = `${url || ''}`.trim()
        if(!value) return ''

        if(/^(?:chrome|edge|about|moz-extension|chrome-error):/i.test(value)) return value

        try {
            const parsed = new URL(value)
            const hostname = `${parsed.hostname || ''}`.toLowerCase()
            if(parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return value
            if(hostname && hostname !== 'quora.com' && hostname !== 'www.quora.com' && !hostname.endsWith('.quora.com')) {
                return value
            }
        }
        catch {
            return value
        }

        return ''
    }

    function serializeOwnedTabIdsByParent() {
        const serialized = {}

        for(const [parentTabId, childTabIds] of queueRuntime.listOwnedTabParentEntries()) {
            if(!childTabIds.length) continue
            serialized[parentTabId] = childTabIds
        }

        return serialized
    }

    function rebuildOwningParentByChild() {
        queueRuntime.rebuildOwningParentByChild()
    }

    function schedulePersistOwnedTabIdsByParent(delayMs = 250) {
        clearTimeoutFn(getPersistOwnedTabIdsTimeout())
        setPersistOwnedTabIdsTimeout(setTimeoutFn(() => {
            setPersistOwnedTabIdsTimeout(null)
            void persistOwnedTabIdsByParent()
        }, delayMs))
    }

    // Tabs this worker has seen removed, and the probes still waiting on each tab. A tab we close on completion can no longer
    // answer, so its waiting probes settle at once instead of sitting out the full timeout.
    const removedTabIds = new Set()
    const pendingTabMessages = new Map()

    function noteTabRemoved(tabId) {
        const key = `${tabId}`
        removedTabIds.add(key)
        if(removedTabIds.size > 500) removedTabIds.delete(removedTabIds.values().next().value)
        const waiters = pendingTabMessages.get(key)
        if(!waiters) return
        pendingTabMessages.delete(key)
        for(const settleWaiter of waiters) settleWaiter('removed')
    }

    function sendTabMessage(tabId, message, timeoutMs = 3000) {
        // Undelivered and timed-out messages both come back as no response, so the reason is recorded here.
        // Close checks also record how long the tab took to answer, or that it answered after the timeout, with the calling site.
        const startedAt = Date.now()
        const action = message?.action || ''
        const probeSource = message?.probeSource || ''
        const isCloseCheck = action === 'close-if-blocked'
        const key = `${tabId}`
        if(isCloseCheck && removedTabIds.has(key)) {
            recordFlightRecorderEvent({kind: 'close-check-skipped-removed', tabId, probeSource})
            return Promise.resolve(null)
        }

        let timedOut = false
        const delivery = browser.tabs.sendMessage(tabId, message).then(response => {
            if(isCloseCheck) {
                recordFlightRecorderEvent({
                    kind: timedOut ? 'close-check-late-reply' : 'close-check-reply',
                    tabId,
                    probeSource,
                    elapsedMs: Date.now() - startedAt,
                    willClose: response?.willClose === true,
                    reason: response?.reason || ''
                })
            }
            return response
        }).catch(error => {
            if(/Receiving end does not exist|no tab|invalid tab|cannot find tab|not found/i.test(error?.message || '')) {
                recordFlightRecorderEvent({kind: 'tab-message-undelivered', tabId, action, probeSource, elapsedMs: Date.now() - startedAt, error: error?.message || ''})
                return
            }
            throw error
        })

        if(!timeoutMs || timeoutMs <= 0) return delivery

        let finished = false
        let timer = null
        let resolveWait = () => {}
        const wait = new Promise(resolve => { resolveWait = resolve })
        const settleWaiter = how => {
            if(finished) return
            finished = true
            clearTimeoutFn(timer)
            const waiters = pendingTabMessages.get(key)
            waiters?.delete(settleWaiter)
            if(waiters?.size === 0) pendingTabMessages.delete(key)
            if(how === 'removed' && isCloseCheck) {
                recordFlightRecorderEvent({kind: 'close-check-settled-removed', tabId, probeSource, elapsedMs: Date.now() - startedAt})
            }
            resolveWait(null)
        }
        timer = setTimeoutFn(() => {
            if(finished) return
            timedOut = true
            recordFlightRecorderEvent({kind: 'tab-message-timeout', tabId, action, probeSource, timeoutMs})
            if(isCloseCheck) {
                // What the tab looked like when it failed to answer: loading, discarded, audible, and the URL path only.
                Promise.resolve()
                    .then(() => browser.tabs.get(tabId))
                    .then(tab => recordFlightRecorderEvent({
                        kind: 'close-check-timeout-tab',
                        tabId,
                        probeSource,
                        tabStatus: tab?.status || '',
                        discarded: tab?.discarded === true,
                        audible: tab?.audible === true,
                        urlPath: (() => { try { return new URL(tab?.url || '').pathname } catch { return '' } })()
                    }), () => recordFlightRecorderEvent({kind: 'close-check-timeout-tab', tabId, probeSource, tabStatus: 'missing'}))
            }
            settleWaiter('timeout')
        }, timeoutMs)
        if(!pendingTabMessages.has(key)) pendingTabMessages.set(key, new Set())
        pendingTabMessages.get(key).add(settleWaiter)

        return Promise.race([delivery, wait])
    }

    function registerOwnedTab(parentTabId, childTabId) {
        const normalizedParentTabId = normalizeOwnedParentId(parentTabId)
        if(!normalizedParentTabId || !childTabId) return

        queueRuntime.addOwnedTab(normalizedParentTabId, childTabId)
        schedulePersistOwnedTabIdsByParent()
    }

    function unregisterOwnedTab(childTabId) {
        if(!childTabId) return
        if(queueRuntime.removeOwnedTab(childTabId)) schedulePersistOwnedTabIdsByParent()
    }

    return {
        getErrorPageUrl,
        serializeOwnedTabIdsByParent,
        rebuildOwningParentByChild,
        schedulePersistOwnedTabIdsByParent,
        sendTabMessage,
        noteTabRemoved,
        registerOwnedTab,
        unregisterOwnedTab
    }
}

module.exports = {
    createOwnedTabLifecycle
}
