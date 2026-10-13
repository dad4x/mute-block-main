// Queued-executor tab status lookup helpers extracted from sw.js
// (decomposition Part 2 target #15, 2026-09-14): getQueuedExecutorTabStatusWithTimeout,
// getQueuedExecutorTabStatusFromTabList, and getQueuedExecutorTabWithTimeout,
// a tightly-coupled cluster (the first falls back to the second on a timeout,
// and the third is a thin tab-only wrapper around the first) pulled out
// together rather than split across separate slices.
//
// Construction-order note: this module is constructed in sw.js immediately
// after coordinatorRuns's destructure and before makeQueuedTabOpenUrlCommitHelpers,
// which eagerly references getQueuedExecutorTabStatusWithTimeout bare in its
// own construction-call handlers object literal -- the earliest such eager
// reference. normalizeTabId (tabIdUtils) and incrementQueueWakeupMetric
// (queueWakeupMetricsShape) are both already bare consts by that point;
// promiseWithTimeout is a plain hoisted `function` declaration further below
// in sw.js and is visible from anywhere in that scope regardless of position.
//
// Promise-chain realm-crossing scrutiny (per architecture.md's Slice-7
// refinement): every body was grepped for `.then(`, `.catch(`, `Promise.`,
// and `setTimeout` -- only `await`, all reaching into `browser.tabs` (a
// host API, not another `require()`'d module) or into promiseWithTimeout/
// incrementQueueWakeupMetric (plain deps, not `.then()` chains), so no
// realm-crossing concern.

function createQueuedExecutorTabStatus(deps = {}) {
    const {
        browser,
        promiseWithTimeout,
        normalizeTabId,
        incrementQueueWakeupMetric,
        normalizeStorageMetricPathName
    } = deps.handlers || {}
    const {
        QUEUED_TAB_GET_TIMEOUT_MS
    } = deps.constants || {}

    async function getQueuedExecutorTabStatusFromTabList(tabId = null, reason = 'queued-executor-tab-list') {
        const normalizedTabId = normalizeTabId(tabId)
        if(!normalizedTabId) {
            return {
                tab: null,
                found: false,
                missing: false,
                timedOut: false,
                error: 'missing-tab-id'
            }
        }

        try {
            const tabs = await promiseWithTimeout(
                browser.tabs.query({}),
                QUEUED_TAB_GET_TIMEOUT_MS,
                `${reason || 'queued-executor-tab-list'} tab-list ${normalizedTabId}`
            )
            const tab = (tabs || []).find(candidate => normalizeTabId(candidate?.id) === normalizedTabId) || null
            return {
                tab,
                found: !!tab,
                missing: !tab,
                timedOut: false,
                error: ''
            }
        }
        catch(error) {
            const message = error?.message || `${error || ''}`
            const timedOut = /timed out/i.test(message)
            if(timedOut) incrementQueueWakeupMetric('job.tabListTimedOut')
            return {
                tab: null,
                found: false,
                missing: false,
                timedOut,
                error: message
            }
        }
    }

    async function getQueuedExecutorTabStatusWithTimeout(tabId = null, reason = 'queued-executor-tab-get') {
        const normalizedTabId = normalizeTabId(tabId)
        if(!normalizedTabId) {
            return {
                tab: null,
                found: false,
                missing: false,
                timedOut: false,
                error: 'missing-tab-id'
            }
        }

        try {
            const tab = await promiseWithTimeout(
                browser.tabs.get(normalizedTabId),
                QUEUED_TAB_GET_TIMEOUT_MS,
                `${reason || 'queued-executor-tab-get'} ${normalizedTabId}`
            )
            return {
                tab: tab || null,
                found: !!tab,
                missing: !tab,
                timedOut: false,
                error: ''
            }
        }
        catch(error) {
            const message = error?.message || `${error || ''}`
            const timedOut = /timed out/i.test(message)
            // 2026-10-08: broken out by caller-supplied `reason` (already
            // threaded through every call site for exactly this kind of
            // attribution) so the next handoff-latency check can tell which
            // caller's tab lookups are actually driving the aggregate
            // tabGetFailed/tabGetTimedOut ratio, instead of guessing from a
            // single flat counter shared by all 13+ call sites.
            const reasonTag = normalizeStorageMetricPathName(reason || 'queued-executor-tab-get')
            incrementQueueWakeupMetric('job.tabGetFailed')
            incrementQueueWakeupMetric(`job.tabGetFailed.byReason.${reasonTag}`)
            if(timedOut) {
                incrementQueueWakeupMetric('job.tabGetTimedOut')
                incrementQueueWakeupMetric(`job.tabGetTimedOut.byReason.${reasonTag}`)
                const queryResult = await getQueuedExecutorTabStatusFromTabList(normalizedTabId, reason)
                if(queryResult.found || queryResult.missing) {
                    return {
                        ...queryResult,
                        timedOut: true,
                        error: message
                    }
                }
            }
            return {
                tab: null,
                found: false,
                missing: !timedOut && /no tab|no fake tab|invalid tab|cannot find tab|not found/i.test(message),
                timedOut,
                error: message
            }
        }
    }

    async function getQueuedExecutorTabWithTimeout(tabId = null, reason = 'queued-executor-tab-get') {
        const result = await getQueuedExecutorTabStatusWithTimeout(tabId, reason)
        return result.tab || null
    }

    return {
        getQueuedExecutorTabStatusFromTabList,
        getQueuedExecutorTabStatusWithTimeout,
        getQueuedExecutorTabWithTimeout
    }
}

module.exports = {
    createQueuedExecutorTabStatus
}
