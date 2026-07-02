async function createQueuedExecutorBrowserTabEffect(deps = {}, options = {}, label = 'queued executor tab create') {
    const {
        browser,
        createTimeoutMs = 10000,
        recordFlightRecorderEvent = () => {},
        incrementQueueWakeupMetric = () => {},
        setTimeoutFn = setTimeout,
        clearTimeoutFn = clearTimeout
    } = deps

    recordFlightRecorderEvent({
        kind: 'tab-open-request',
        source: 'createQueuedExecutorBrowserTab',
        targetUrl: options.url || '',
        windowId: options.windowId || null,
        accepted: true,
        reason: label
    })

    let timedOut = false
    let settled = false
    let timeoutId = null
    const createPromise = Promise.resolve()
        .then(() => browser.tabs.create(options))
        .then(tab => {
            settled = true
            if(timeoutId && !timedOut) {
                clearTimeoutFn(timeoutId)
                timeoutId = null
            }
            if(timedOut && tab?.id) {
                incrementQueueWakeupMetric('pump.changed.closedLateCreatedTab')
                void browser.tabs.remove(tab.id).catch(() => null)
            }
            return tab
        }, error => {
            if(timedOut) {
                incrementQueueWakeupMetric('pump.noop.lateTabCreateRejected')
                return null
            }
            throw error
        })
    const timeoutPromise = new Promise((resolve, reject) => {
        timeoutId = setTimeoutFn(() => {
            if(settled) return
            timedOut = true
            incrementQueueWakeupMetric('pump.noop.tabCreateTimedOut')
            reject(new Error(`${label} timed out after ${createTimeoutMs}ms`))
        }, createTimeoutMs)
    })

    try {
        const tab = await Promise.race([
            createPromise,
            timeoutPromise
        ])
        if(!tab?.id) throw new Error(`${label} did not create a tab`)
        await browser.tabs.get(tab.id)
        return tab
    }
    finally {
        if(timeoutId && !timedOut) clearTimeoutFn(timeoutId)
    }
}

function makeQueuedTabOpenUrlCommitHelpers(deps = {}) {
    const {
        browser,
        getQueuedExecutorTabStatusWithTimeout,
        getTabObservedUrls,
        incrementQueueWakeupMetric = () => {},
        normalizeCoordinatorRequestedUrl,
        normalizeQuoraProfileUrl,
        normalizeTabId,
        normalizeTabTargetUrl,
        openUrlCommitTimeoutMs = 5000,
        pollMs = 250,
        setTimeoutFn = setTimeout,
        now = () => Date.now()
    } = deps

    function queuedTabMatchesExpectedOpenUrl(tab = null, expectedUrl = '') {
        const expectedHref = normalizeQuoraProfileUrl(expectedUrl || '')
        const normalizedExpectedUrl = normalizeCoordinatorRequestedUrl(expectedUrl || '')
        return getTabObservedUrls(tab).some(observedUrl => {
            if(expectedHref && normalizeQuoraProfileUrl(observedUrl) === expectedHref) return true
            return normalizedExpectedUrl &&
                normalizeCoordinatorRequestedUrl(observedUrl) === normalizedExpectedUrl
        })
    }

    async function waitForQueuedTabExpectedOpenUrl(tabId = null, expectedUrl = '', timeoutMs = openUrlCommitTimeoutMs) {
        const startedAt = now()
        while(now() - startedAt < timeoutMs) {
            const status = await getQueuedExecutorTabStatusWithTimeout(tabId, 'queued-tab-open-url-commit')
            if(status.tab && queuedTabMatchesExpectedOpenUrl(status.tab, expectedUrl)) return status.tab
            if(status.missing) return null
            await new Promise(resolve => setTimeoutFn(resolve, pollMs))
        }

        const status = await getQueuedExecutorTabStatusWithTimeout(tabId, 'queued-tab-open-url-commit-final')
        return status.tab && queuedTabMatchesExpectedOpenUrl(status.tab, expectedUrl) ? status.tab : null
    }

    async function ensureCreatedQueuedTabCommittedToExpectedUrl(tab = null, action = {}, options = {}) {
        const tabId = normalizeTabId(tab?.id)
        const expectedUrl = normalizeTabTargetUrl(options.url || action.url || action.requestedUrl || action.profileHref || '')
        if(!tabId || !expectedUrl) return tab
        if(queuedTabMatchesExpectedOpenUrl(tab, expectedUrl)) return tab

        const committed = await waitForQueuedTabExpectedOpenUrl(tabId, expectedUrl)
        if(committed) return committed

        await browser.tabs.update(tabId, {url: expectedUrl}).catch(() => null)
        const committedAfterRetry = await waitForQueuedTabExpectedOpenUrl(tabId, expectedUrl)
        if(committedAfterRetry) return committedAfterRetry

        incrementQueueWakeupMetric('job.tabOpenUrlCommitFailed')
        throw new Error('queued-tab-open-url-not-committed')
    }

    return {
        ensureCreatedQueuedTabCommittedToExpectedUrl,
        queuedTabMatchesExpectedOpenUrl,
        waitForQueuedTabExpectedOpenUrl
    }
}

module.exports = {
    createQueuedExecutorBrowserTabEffect,
    makeQueuedTabOpenUrlCommitHelpers
}
