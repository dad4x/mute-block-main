// The queue bar's summary (historical/coder-instructions-2026-10-18.md, section 4 item 2; decisions 9 and 11). The worker keeps
// {total, pending, updatedAt} in memory. It is recorded from each queue view the worker broadcasts, and a change is pushed to every
// open Quora tab with tabs.sendMessage. Content asks for it by runtime message. Nothing is written to any storage area.
//
// Content is bundled, so it imports this module too. The worker-side state (currentQueueBarSummary) is only used in the worker realm.

const {createCoordinatorStatusRules} = require('./swCoordinatorStatusRules')

const QUEUE_BAR_GET_ACTION = 'get-queue-bar-summary'
const QUEUE_BAR_PUSH_ACTION = 'queue-bar-summary-pushed'

// The pending statuses (queued, opening, active, acting, settling) are the ones the status rules name. Content used to list them
// itself, so this module is the one place they are read from.
const {isPendingCoordinatorStatus} = createCoordinatorStatusRules({})

function makeQueueBarSummary(fields = {}) {
    return {
        total: Math.max(0, Number.parseInt(fields.total, 10) || 0),
        pending: Math.max(0, Number.parseInt(fields.pending, 10) || 0),
        updatedAt: Number.parseInt(fields.updatedAt, 10) || 0
    }
}

// The summary of a queue view. The view's counts give the pending total, as content computed it from the view before.
// A view without an items array counts as no view: total 0.
function summarizeQueueBarView(view = null, nowMs = 0) {
    if(!view || typeof view !== 'object' || !Array.isArray(view.items)) {
        return makeQueueBarSummary({total: 0, pending: 0, updatedAt: nowMs})
    }
    const counts = view.counts && typeof view.counts === 'object' ? view.counts : {}
    let pending = 0
    for(const [status, count] of Object.entries(counts)) {
        if(isPendingCoordinatorStatus(status)) pending += Number.parseInt(count, 10) || 0
    }
    return makeQueueBarSummary({total: view.total, pending, updatedAt: nowMs})
}

let currentQueueBarSummary = null

// Records a summary and reports whether its total or pending count changed. updatedAt alone is not a change, so a heartbeat
// that moves no count pushes nothing.
function recordQueueBarSummary(fields = {}) {
    const next = makeQueueBarSummary(fields)
    const previous = currentQueueBarSummary
    const changed = !previous || previous.total !== next.total || previous.pending !== next.pending
    currentQueueBarSummary = next
    return {summary: {...next}, changed}
}

// The summary as the worker holds it, or null when none has been recorded since startup.
function getQueueBarSummary() {
    return currentQueueBarSummary ? {...currentQueueBarSummary} : null
}

// The bar's display for a summary (decision 13, 18 Oct). It is shown while work is queued and the queue is not paused, from 0/total
// up. It is hidden when nothing is queued (pending 0 or total 0), when the batch is done, or when the queue is paused. A missing
// summary (the read failed, or none has been recorded) shows nothing.
function getQueueBarDisplay(summary = null, paused = false) {
    const total = Number.parseInt(summary?.total, 10) || 0
    const pending = Number.parseInt(summary?.pending, 10) || 0
    const terminal = Math.max(0, total - pending)
    return {
        visible: !paused && total > 0 && pending > 0,
        total,
        terminal,
        percent: total > 0 ? Math.min(100, Math.round((terminal / total) * 100)) : 0
    }
}

// The tabs that have asked for the summary (decision 15, 18 Oct): a content script sends get-queue-bar-summary with its sender's tab
// id, and only those tabs receive pushes. No URL matching. A tab that rejects a push is dropped from the set; it asks again on its
// next load.
const queueBarSubscriberTabIds = new Set()

function subscribeQueueBarTab(tabId) {
    if(Number.isInteger(tabId)) queueBarSubscriberTabIds.add(tabId)
}

function getQueueBarSubscriberTabIds() {
    return [...queueBarSubscriberTabIds]
}

// Pushes a summary to every subscribed tab. The caller does not wait for it. Resolves to the number of tabs that took it.
function pushQueueBarSummary(browser, summary = null) {
    const tabIds = getQueueBarSubscriberTabIds()
    return Promise.all(tabIds.map(tabId => {
        try {
            return Promise.resolve(browser.tabs.sendMessage(tabId, {action: QUEUE_BAR_PUSH_ACTION, summary}))
                .then(() => true, () => {
                    queueBarSubscriberTabIds.delete(tabId)
                    return false
                })
        }
        catch {
            queueBarSubscriberTabIds.delete(tabId)
            return Promise.resolve(false)
        }
    })).then(results => results.filter(Boolean).length)
}

module.exports = {
    QUEUE_BAR_GET_ACTION,
    QUEUE_BAR_PUSH_ACTION,
    makeQueueBarSummary,
    summarizeQueueBarView,
    recordQueueBarSummary,
    getQueueBarSummary,
    getQueueBarDisplay,
    subscribeQueueBarTab,
    getQueueBarSubscriberTabIds,
    pushQueueBarSummary
}
