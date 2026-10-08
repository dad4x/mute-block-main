// Coordinator queue-view / accounting summarization functions extracted
// from sw.js (decomposition Slice 13). This is the dashboard/accounting
// read-model layer built on top of the status rulebook (swCoordinatorStatusRules.js,
// Slice 12): sort-rank and time ordering for the compact queue view, actual-
// block and activation-handoff timing summaries, per-item view shaping, the
// compact-view filter, the top-level view builder, and the queue-accounting
// count/comparison helpers used to detect raw-vs-recovered and stored-vs-
// rebuilt divergence.
//
// No TDZ construction-order split was needed for this slice (unlike Slices
// 11 and 12): none of these 19 names are referenced eagerly by any already-
// extracted module's construction-call object literal (checked every module
// under shared/js/sw*.js, not just the fifteen most-recently-extracted
// ones), so this module constructs in place, at the cluster's old
// source-text position, after coordinatorStatusRules, coordinatorProgressRules,
// profileResolution, and browserSessionRuntime -- all of which it depends on
// -- already exist.
//
// Every body was grepped for `.then(`, `.catch(`, `Promise.`, `async`, and
// `setTimeout` before moving, per architecture.md's Slice-7 realm-crossing
// refinement -- none of the 19 functions has any of these, so no realm-
// crossing risk.
//
// Clock note: buildCoordinatorQueueView reads Date.now() via a default
// parameter (`now = Date.now()`), which -- per the Slice 12 clock-note
// precedent -- evaluates in the *defining* function's own realm when the
// caller omits the argument, not the caller's. Several call sites in sw.js
// omit that argument. `now` is threaded through this module's deps as
// `() => Date.now()` and the default parameter reads `now()` instead.
//
// getCoordinatorQueueViewEpochStartedAt reads the module-level `queueWakeupMetrics`
// closure variable directly in sw.js; that variable itself is not extracted
// (queueWakeupMetricsShape only owns getter/setter access to it), so it is
// threaded through as a `getQueueWakeupMetrics` handler dep, matching the
// existing getter/setter convention used at queueWakeupMetricsShape's own
// construction call.

// 2026-09-14: a WAL corruption incident left the coordinator unable to
// persist any state for several hours; once recovered, the one row still
// mid-flight from before the outage (and the handoff gap to whatever
// activated right after recovery) each carried a multi-hour duration --
// technically accurate, but it silently poisoned the "current epoch"
// secs/block and handoff-sec averages below for as long as that sample
// stayed within the 100-sample/epoch window, since neither average had any
// protection against a single implausible outlier. COORDINATOR_TIMING_SAMPLE_MAX_PLAUSIBLE_MS
// excludes any single block duration or handoff gap above this ceiling from
// the average (30 minutes -- well above any real slow-but-working sample
// this project has seen, which top out around 10-12 minutes during a
// post-incident ramp-up, but far below a multi-hour stall/outage).
// Excluded samples are still counted (excludedOutliers) so the UI can
// surface that something was dropped, rather than silently.
const COORDINATOR_TIMING_SAMPLE_MAX_PLAUSIBLE_MS = 1800000

function createCoordinatorQueueView(deps = {}) {
    const {now} = deps
    const {
        isActiveCoordinatorStatus,
        isRetryableCoordinatorFailure,
        isTerminalCoordinatorStatus,
        isCoordinatorQueueAuthoritativeItem,
        getFirstPositiveNumber,
        normalizeObjectNumberMap,
        normalizeCoordinatorItemProvenance,
        getWalRecordsForGeneration,
        getQueueWakeupMetrics
    } = deps.handlers || {}
    const {UNBLOCK_UNMUTE_ACTION_KIND} = deps.constants || {}

    function getCoordinatorQueueViewSortRank(item = {}) {
        const status = `${item?.status || ''}`.trim()
        if(isActiveCoordinatorStatus(status)) return 0
        if(status === 'queued') return 1
        if(isRetryableCoordinatorFailure(item)) return 2
        if(status === 'failed') return 3
        if(!isTerminalCoordinatorStatus(status)) return 4
        return 5
    }

    function getCoordinatorQueueViewTime(item = {}) {
        return Number.parseInt(
            item?.terminalAt ||
            item?.updatedAt ||
            item?.activeAt ||
            item?.queuedAt ||
            item?.createdAt,
            10
        ) || 0
    }

    function getCoordinatorQueueViewEpochStartedAt() {
        return Number.parseInt(getQueueWakeupMetrics()?.currentEpoch?.startedAt, 10) || 0
    }

    function isCoordinatorActualBlockSuccess(item = {}) {
        if(`${item?.status || ''}` !== 'succeeded') return false
        if(`${item?.actionKind || ''}` === UNBLOCK_UNMUTE_ACTION_KIND) return false
        if(`${item?.outcome || ''}` === 'already-blocked') return false
        if(`${item?.outcome || ''}` === 'blocked') return true

        const milestones = item?.milestones || {}
        return getFirstPositiveNumber(
            item?.blockAttemptedAt,
            milestones.blockAttemptedAt
        ) > 0
    }

    // The exact complement of isCoordinatorActualBlockSuccess's
    // already-blocked exclusion -- a completed skip that never performed a
    // genuine block action, so its active-to-terminal time measures
    // "confirm already blocked and move on," not "perform a block."
    function isCoordinatorAlreadyBlockedSuccess(item = {}) {
        if(`${item?.status || ''}` !== 'succeeded') return false
        if(`${item?.actionKind || ''}` === UNBLOCK_UNMUTE_ACTION_KIND) return false
        return `${item?.outcome || ''}` === 'already-blocked'
    }

    function getCoordinatorActualBlockTerminalTime(item = {}) {
        return getFirstPositiveNumber(item?.terminalAt, item?.blockedAt, item?.updatedAt, item?.createdAt)
    }

    function getCoordinatorActualBlockActiveStartTime(item = {}) {
        const milestones = item?.milestones || {}
        return getFirstPositiveNumber(
            item?.activeAt,
            item?.actionReadyAt,
            milestones.actionReadyAt,
            item?.blockAttemptedAt,
            milestones.blockAttemptedAt,
            item?.tabOpenedAt,
            milestones.tabOpenedAt,
            item?.contentOpenedAt,
            milestones.contentOpenedAt
        )
    }

    // Shared by summarizeCoordinatorActualBlockTiming ("secs / real block")
    // and summarizeCoordinatorAlreadyBlockedTiming ("secs / already
    // blocked") -- same sampling/outlier/epoch-floor logic, differing only
    // in which of the two (mutually exclusive, see
    // isCoordinatorActualBlockSuccess / isCoordinatorAlreadyBlockedSuccess)
    // completed-row predicates selects the samples.
    function summarizeCoordinatorBlockLikeTiming(queue = {}, epochStartedAt = 0, matchesSuccess = () => false) {
        const minimumTerminalAt = Number.parseInt(epochStartedAt, 10) || 0
        // 2026-09-27: floored by minimumTerminalAt again -- the epoch this
        // comes from (queueWakeupMetrics' currentEpoch.startedAt) only
        // actually moves on a genuine reset (an extension-version-bump
        // reload, or an explicit "Reset metrics" click -- see
        // resetQueueWakeupMetricsEpoch), never on an ordinary same-version
        // service-worker restart/idle-eviction. The 2026-09-25 fix that
        // removed this floor was guarding against exactly the wrong case:
        // a ROUTINE restart silently hiding a row that had just terminalized
        // (durable, not stale). But that made these two cards not reset on
        // a *deliberate* reload/Reset-metrics either, which is confusing --
        // this tile should read "fresh" right after you ask it to. The
        // tradeoff accepted here: a row that finishes in the same instant as
        // a deliberate reset can be excluded from the very next reading,
        // which is a much smaller cost than never resetting at all.
        // COORDINATOR_TIMING_SAMPLE_MAX_PLAUSIBLE_MS below (plus the recency
        // sort + 100-sample cap) still guards against genuinely stale/
        // implausible data contaminating the average within one epoch.
        const samples = Object.values(queue || {})
            .filter(item => {
                if(!matchesSuccess(item)) return false
                const terminalAt = getCoordinatorActualBlockTerminalTime(item)
                return terminalAt > 0 && terminalAt >= minimumTerminalAt
            })
            .sort((left, right) => getCoordinatorActualBlockTerminalTime(right) - getCoordinatorActualBlockTerminalTime(left))
            .slice(0, 100)

        const allDurations = samples
            .map(item => {
                const startedAt = getCoordinatorActualBlockActiveStartTime(item)
                const terminalAt = getCoordinatorActualBlockTerminalTime(item)
                return startedAt > 0 && terminalAt > startedAt ? terminalAt - startedAt : 0
            })
            .filter(duration => duration > 0)
        const durations = allDurations.filter(duration => duration <= COORDINATOR_TIMING_SAMPLE_MAX_PLAUSIBLE_MS)
        const excludedOutliers = allDurations.length - durations.length
        const elapsedMs = durations.reduce((total, duration) => total + duration, 0)
        const blocks = durations.length

        return {
            epochStartedAt: minimumTerminalAt,
            sampleLimit: 100,
            blocks,
            excludedOutliers,
            elapsedMs,
            seconds: blocks ? (elapsedMs / 1000) / blocks : 0
        }
    }

    function summarizeCoordinatorActualBlockTiming(queue = {}, epochStartedAt = 0) {
        return summarizeCoordinatorBlockLikeTiming(queue, epochStartedAt, isCoordinatorActualBlockSuccess)
    }

    function summarizeCoordinatorAlreadyBlockedTiming(queue = {}, epochStartedAt = 0) {
        return summarizeCoordinatorBlockLikeTiming(queue, epochStartedAt, isCoordinatorAlreadyBlockedSuccess)
    }

    function getCoordinatorActivationHandoffTerminalTime(item = {}) {
        return getFirstPositiveNumber(item?.terminalAt, item?.updatedAt, item?.createdAt)
    }

    function getCoordinatorActivationHandoffActiveTime(item = {}) {
        return getFirstPositiveNumber(item?.activeAt)
    }

    function getCoordinatorPauseWindowsOverlapMs(pauseWindows = [], startMs = 0, endMs = 0, nowMs = now()) {
        if(!Array.isArray(pauseWindows) || !pauseWindows.length || endMs <= startMs) return 0

        let overlap = 0
        for(const window of pauseWindows) {
            const pausedAt = Number.parseInt(window?.pausedAt, 10) || 0
            if(!pausedAt) continue
            const resumedAt = Number.parseInt(window?.resumedAt, 10) || nowMs
            const overlapStart = Math.max(startMs, pausedAt)
            const overlapEnd = Math.min(endMs, resumedAt)
            if(overlapEnd > overlapStart) overlap += overlapEnd - overlapStart
        }
        return overlap
    }

    // Same fix shape as getCoordinatorPauseWindowsOverlapMs above, for
    // queueLoadThrottleWindows ({activatedAt, clearedAt}) instead of
    // pauseWindows ({pausedAt, resumedAt}) -- a queueLoadThrottle-active
    // stretch (Quora-pushback backoff) between two rows was still counting
    // in full as handoff time, same contaminant category as an unaccounted
    // pause.
    function getCoordinatorQueueLoadThrottleWindowsOverlapMs(queueLoadThrottleWindows = [], startMs = 0, endMs = 0, nowMs = now()) {
        if(!Array.isArray(queueLoadThrottleWindows) || !queueLoadThrottleWindows.length || endMs <= startMs) return 0

        let overlap = 0
        for(const window of queueLoadThrottleWindows) {
            const activatedAt = Number.parseInt(window?.activatedAt, 10) || 0
            if(!activatedAt) continue
            const clearedAt = Number.parseInt(window?.clearedAt, 10) || nowMs
            const overlapStart = Math.max(startMs, activatedAt)
            const overlapEnd = Math.min(endMs, clearedAt)
            if(overlapEnd > overlapStart) overlap += overlapEnd - overlapStart
        }
        return overlap
    }

    function summarizeCoordinatorActivationHandoffTiming(queue = {}, epochStartedAt = 0, pauseWindows = [], nowMs = now(), queueLoadThrottleWindows = []) {
        const minimumTerminalAt = Number.parseInt(epochStartedAt, 10) || 0
        const entries = Object.entries(queue || {})
        const activations = entries
            .map(([key, item]) => ({
                key,
                item,
                runId: `${item?.runId || ''}`.trim(),
                activeAt: getCoordinatorActivationHandoffActiveTime(item)
            }))
            .filter(sample => sample.activeAt > 0 && sample.runId)
            .sort((left, right) => left.activeAt - right.activeAt)
        const terminals = entries
            .map(([key, item]) => ({
                key,
                item,
                runId: `${item?.runId || ''}`.trim(),
                terminalAt: getCoordinatorActivationHandoffTerminalTime(item)
            }))
            .filter(sample => {
                if(!isTerminalCoordinatorStatus(sample.item?.status)) return false
                // See the matching comment in summarizeCoordinatorActualBlockTiming
                // -- floored by minimumTerminalAt again, same reasoning.
                return sample.runId && sample.terminalAt > 0 && sample.terminalAt >= minimumTerminalAt
            })
            .sort((left, right) => left.terminalAt - right.terminalAt)

        // 2026-09-30: this used to be `activations.find(...)` -- an O(activations)
        // linear scan of the *entire* activations array, re-run from scratch for
        // every terminal row, i.e. O(terminals * activations) for this function
        // alone. Confirmed as the dominant cause of per-block time scaling with
        // queue depth (every active-transition/terminal-settlement WAL write
        // rebuilds the whole queue view, and this was the one piece of that
        // rebuild that was itself quadratic in queue size, not just linear).
        // `activations` is already sorted ascending by activeAt, so grouping by
        // runId once preserves that order per bucket, and each terminal's "first
        // activation after terminalAt, same run, not itself" lookup becomes a
        // binary search instead of a full rescan -- same matching semantics,
        // O(log k) instead of O(activations) per terminal.
        const activationsByRunId = new Map()
        for(const activation of activations) {
            let bucket = activationsByRunId.get(activation.runId)
            if(!bucket) {
                bucket = []
                activationsByRunId.set(activation.runId, bucket)
            }
            bucket.push(activation)
        }
        function findNextActivationForTerminal(terminal) {
            const bucket = activationsByRunId.get(terminal.runId)
            if(!bucket || !bucket.length) return null
            let low = 0
            let high = bucket.length
            while(low < high) {
                const mid = (low + high) >>> 1
                if(bucket[mid].activeAt > terminal.terminalAt) high = mid
                else low = mid + 1
            }
            for(let index = low; index < bucket.length; index++) {
                if(bucket[index].key !== terminal.key) return bucket[index]
            }
            return null
        }

        const samples = []
        for(const terminal of terminals) {
            const nextActivation = findNextActivationForTerminal(terminal)
            if(!nextActivation) continue
            // 2026-09-27: a paused span sitting between this terminal row
            // and the next row (same run) becoming active used to count in
            // full as "handoff time" -- confirmed live to be a real
            // contaminant (a several-hour pause inflated this exact
            // average), not a hypothetical one. Subtracting any recorded
            // pause-window overlap makes gapMs reflect actual processing
            // latency instead of however long the queue happened to sit
            // paused in between.
            const pausedOverlapMs = getCoordinatorPauseWindowsOverlapMs(pauseWindows, terminal.terminalAt, nextActivation.activeAt, nowMs)
            const throttledOverlapMs = getCoordinatorQueueLoadThrottleWindowsOverlapMs(queueLoadThrottleWindows, terminal.terminalAt, nextActivation.activeAt, nowMs)
            samples.push({
                terminalKey: terminal.key,
                runId: terminal.runId,
                terminalStatus: terminal.item?.status || '',
                terminalOutcome: terminal.item?.outcome || '',
                terminalAt: terminal.terminalAt,
                nextActiveKey: nextActivation.key,
                nextActiveStatus: nextActivation.item?.status || '',
                nextActiveAt: nextActivation.activeAt,
                gapMs: Math.max(0, nextActivation.activeAt - terminal.terminalAt - pausedOverlapMs - throttledOverlapMs)
            })
            if(samples.length >= 100) break
        }

        const allGaps = samples
            .map(sample => Number.parseInt(sample.gapMs, 10) || 0)
            .filter(gap => gap > 0)
            .sort((left, right) => left - right)
        const gaps = allGaps.filter(gap => gap <= COORDINATOR_TIMING_SAMPLE_MAX_PLAUSIBLE_MS)
        const excludedOutliers = allGaps.length - gaps.length
        const elapsedMs = gaps.reduce((total, gap) => total + gap, 0)
        const handoffs = gaps.length
        const p95Index = handoffs ? Math.min(handoffs - 1, Math.ceil(handoffs * 0.95) - 1) : 0

        return {
            epochStartedAt: minimumTerminalAt,
            sampleLimit: 100,
            handoffs,
            excludedOutliers,
            elapsedMs,
            seconds: handoffs ? (elapsedMs / 1000) / handoffs : 0,
            maxMs: handoffs ? gaps[handoffs - 1] : 0,
            p95Ms: handoffs ? gaps[p95Index] : 0,
            samples
        }
    }

    function summarizeCoordinatorQueueViewItem(key = '', item = {}) {
        const source = item && typeof item === 'object' ? item : {}
        return {
            storageKey: key,
            id: source.id || '',
            runId: source.runId || '',
            status: source.status || '',
            outcome: source.outcome || '',
            error: source.error || source.finalError || '',
            actionKind: source.actionKind || '',
            executorTabAction: source.executorTabAction || '',
            executorOwner: source.executorOwner || '',
            serviceWorkerOwned: source.serviceWorkerOwned === true,
            targetProfileHref: source.targetProfileHref || '',
            requestedUrl: source.requestedUrl || '',
            dedupeKey: source.dedupeKey || '',
            tabId: Number.parseInt(source.tabId || source.activeTabId, 10) || 0,
            activeTabId: Number.parseInt(source.activeTabId || source.tabId, 10) || 0,
            attemptId: source.attemptId || source.attempt?.id || '',
            attemptNumber: Number.parseInt(source.attemptNumber || source.attempt?.number, 10) || 0,
            maxAttempts: Number.parseInt(source.maxAttempts || source.attempt?.max, 10) || 0,
            resolveProfileFromPage: source.resolveProfileFromPage === true,
            resolutionMode: source.resolutionMode || '',
            queuedAt: Number.parseInt(source.queuedAt || source.createdAt, 10) || 0,
            createdAt: Number.parseInt(source.createdAt || source.queuedAt, 10) || 0,
            activeAt: Number.parseInt(source.activeAt, 10) || 0,
            terminalAt: Number.parseInt(source.terminalAt, 10) || 0,
            updatedAt: Number.parseInt(source.updatedAt || source.createdAt || source.queuedAt, 10) || 0,
            retryCount: Number.parseInt(source.retryCount, 10) || 0,
            // Needed by the dashboard's own client-side re-sort
            // (compareCurrentWorkItems in coordinator.js), which runs after
            // this summarized view is already in hand and has no other way
            // to recover the real FIFO dispatch order for 'queued' rows --
            // see the 2026-09-16 sort-order fix in this file's own
            // buildCoordinatorQueueView for why time-descending is wrong
            // for that rank.
            queueSequence: Number.parseInt(source.queueSequence, 10) || 0,
            provenance: normalizeCoordinatorItemProvenance(source.provenance) || null,
            source: {
                type: source.source?.type || source.sourceType || '',
                pageUrl: source.source?.pageUrl || source.sourcePage || '',
                searchQuery: source.source?.searchQuery || '',
                sourceLabel: source.source?.sourceLabel || source.sourceLabel || ''
            }
        }
    }

    // Inverse of summarizeCoordinatorQueueViewItem: rebuilds a queue map from
    // a persisted mbCoordinatorQueueView, keyed the same way the live queue
    // is (storageKey, falling back to dedupeKey/targetProfileHref for older
    // view shapes). Used only for WAL "missing-segment" recovery -- the view
    // item isn't a byte-identical copy of the original row (it's the curated
    // subset summarizeCoordinatorQueueViewItem projects), but it carries
    // every field the coordinator's own row-processing reads (status,
    // attempt/retry info, tabId, source, runId, etc.), which is what made
    // the 2026-09-14 manual recovery (tools/cdp/recover-queue-wal-from-view.js)
    // work cleanly against a live corrupted store.
    function buildCoordinatorQueueFromView(view = null) {
        const items = Array.isArray(view?.items)
            ? view.items
            : Object.values(view?.items || {})
        const queue = {}
        for(const item of items) {
            const key = `${item?.storageKey || item?.dedupeKey || item?.targetProfileHref || ''}`.trim()
            if(!key || !item) continue
            queue[key] = item
        }
        return queue
    }

    function filterCoordinatorQueueForCompactView(queue = {}, runs = {}, statsClearedAt = 0) {
        const knownRunIds = new Set(
            Object.keys(runs && typeof runs === 'object' ? runs : {})
                .map(runId => `${runId || ''}`.trim())
                .filter(Boolean)
        )
        const clearedAt = Number.parseInt(statsClearedAt, 10) || 0
        if(!knownRunIds.size && !clearedAt) return queue

        const filteredQueue = {}
        for(const [key, item] of Object.entries(queue || {})) {
            const terminal = isTerminalCoordinatorStatus(item?.status)
            const runId = `${item?.runId || ''}`.trim()
            if(knownRunIds.size && runId && !knownRunIds.has(runId) && terminal) continue
            // See COORDINATOR_STATS_CLEARED_AT_KEY (sw.js): a terminal item
            // that finished at or before the last "Clear All Stats" cutoff
            // is excluded here too, so every caller of buildCoordinatorQueueView
            // -- not just the dashboard's own on-demand refresh -- agrees on
            // what counts as "still showing", instead of the hot-path WAL-
            // append-triggered rebuilds (which call this with no cutoff
            // context of their own) disagreeing and overwriting the filtered
            // result with pre-cutoff rows. Never matches a non-terminal item.
            if(clearedAt && terminal) {
                const terminalAt = Number.parseInt(item?.terminalAt, 10) || 0
                if(terminalAt > 0 && terminalAt <= clearedAt) continue
            }
            filteredQueue[key] = item
        }
        return filteredQueue
    }

    function buildCoordinatorQueueView(queue = {}, nowMs = now(), options = {}) {
        const compactQueue = filterCoordinatorQueueForCompactView(queue, options.runs || {}, options.statsClearedAt || 0)
        const entries = Object.entries(compactQueue || {})
        const epochStartedAt = getCoordinatorQueueViewEpochStartedAt()
        const counts = {}
        const authoritativeCounts = {}
        for(const [, item] of entries) {
            const status = `${item?.status || ''}`.trim() || 'unknown'
            counts[status] = (counts[status] || 0) + 1
            if(isCoordinatorQueueAuthoritativeItem(item)) {
                authoritativeCounts[status] = (authoritativeCounts[status] || 0) + 1
            }
        }
        const hasAuthoritativeStoredWork = ['queued', 'opening', 'active', 'acting', 'settling']
            .some(status => (Number.parseInt(authoritativeCounts[status], 10) || 0) > 0)

        const items = entries
            .sort((left, right) => {
                const leftItem = left[1] || {}
                const rightItem = right[1] || {}
                const rankDiff = getCoordinatorQueueViewSortRank(leftItem) - getCoordinatorQueueViewSortRank(rightItem)
                if(rankDiff) return rankDiff

                // 2026-09-16: within the 'queued' rank, this used to break
                // ties by time descending (most-recently-queued first) --
                // the right ordering for the *active* rank, where "most
                // recent activity" is the interesting thing to surface, but
                // backwards for 'queued': it put the newest arrival at the
                // top and the row that's actually about to be picked up
                // next (the front of the FIFO line) at the bottom, which is
                // exactly the opposite of what "what's about to become
                // active" means. queueRuntime.rebuildQueueOrder (the real
                // executor's base traversal order, before its own
                // backoff/fairness/concurrency filtering) walks queued rows
                // by queueSequence ascending -- so queued rows here sort the
                // same way, ascending, putting the row nearest the front of
                // the real dispatch order at the top.
                if(getCoordinatorQueueViewSortRank(leftItem) === 1) {
                    return (Number.parseInt(leftItem?.queueSequence, 10) || 0) -
                            (Number.parseInt(rightItem?.queueSequence, 10) || 0) ||
                        getCoordinatorQueueViewTime(leftItem) - getCoordinatorQueueViewTime(rightItem) ||
                        `${left[0]}`.localeCompare(`${right[0]}`)
                }

                return getCoordinatorQueueViewTime(rightItem) - getCoordinatorQueueViewTime(leftItem) ||
                    // 2026-09-14: bulk enqueues stamp every row with the same
                    // createdAt/queuedAt millisecond, so the time comparison
                    // above is a wash for an entire batch and this used to
                    // fall straight to an alphabetical key sort -- which has
                    // no relation to the order the executor will actually
                    // run them in (queueRuntime.rebuildQueueOrder picks by
                    // queueSequence). A row 200+ places back in the real
                    // queue could render at the top of this list and look
                    // stuck. queueSequence is assigned to every authoritative
                    // item on enqueue/requeue, so break same-rank/same-time
                    // ties by it before falling back to the key.
                    (Number.parseInt(leftItem?.queueSequence, 10) || 0) -
                        (Number.parseInt(rightItem?.queueSequence, 10) || 0) ||
                    `${left[0]}`.localeCompare(`${right[0]}`)
            })
            .map(([key, item]) => summarizeCoordinatorQueueViewItem(key, item))

        return {
            version: 1,
            updatedAt: nowMs,
            total: entries.length,
            counts,
            authoritativeCounts,
            hasAuthoritativeStoredWork,
            actualBlockTiming: summarizeCoordinatorActualBlockTiming(compactQueue, epochStartedAt),
            alreadyBlockedTiming: summarizeCoordinatorAlreadyBlockedTiming(compactQueue, epochStartedAt),
            activationHandoffTiming: summarizeCoordinatorActivationHandoffTiming(
                compactQueue,
                epochStartedAt,
                getQueueWakeupMetrics()?.currentEpoch?.pauseWindows || [],
                nowMs,
                getQueueWakeupMetrics()?.currentEpoch?.queueLoadThrottleWindows || []
            ),
            itemLimit: items.length,
            truncated: false,
            items
        }
    }

    function makeCoordinatorQueueAccountingCounts(queue = {}) {
        const counts = {}
        const authoritativeCounts = {}
        for(const item of Object.values(queue || {})) {
            const status = `${item?.status || ''}`.trim() || 'unknown'
            counts[status] = (counts[status] || 0) + 1
            if(isCoordinatorQueueAuthoritativeItem(item)) {
                authoritativeCounts[status] = (authoritativeCounts[status] || 0) + 1
            }
        }

        return {
            total: Object.keys(queue || {}).length,
            counts,
            authoritativeCounts
        }
    }

    function normalizeCoordinatorQueueViewAccounting(view = null) {
        if(!view || typeof view !== 'object') {
            return {
                present: false,
                total: 0,
                counts: {},
                authoritativeCounts: {},
                itemCount: 0,
                itemLimit: 0,
                truncated: false,
                updatedAt: 0
            }
        }

        const items = Array.isArray(view.items) ? view.items : []
        return {
            present: true,
            total: Number.parseInt(view.total, 10) || items.length,
            counts: normalizeObjectNumberMap(view.counts || {}),
            authoritativeCounts: normalizeObjectNumberMap(view.authoritativeCounts || {}),
            itemCount: items.length,
            itemLimit: Number.parseInt(view.itemLimit, 10) || 0,
            truncated: view.truncated === true,
            updatedAt: Number.parseInt(view.updatedAt, 10) || 0
        }
    }

    function areCoordinatorAccountingCountsEqual(left = {}, right = {}) {
        const keys = new Set([
            ...Object.keys(left || {}),
            ...Object.keys(right || {})
        ])
        for(const key of keys) {
            if((Number(left?.[key]) || 0) !== (Number(right?.[key]) || 0)) return false
        }
        return true
    }

    function makeCoordinatorQueueAccountingComparison(source = {}, target = {}, prefix = '') {
        const mismatches = []
        if((Number(source.total) || 0) !== (Number(target.total) || 0)) {
            mismatches.push(`${prefix}total`)
        }
        if(!areCoordinatorAccountingCountsEqual(source.counts, target.counts)) {
            mismatches.push(`${prefix}counts`)
        }
        if(!areCoordinatorAccountingCountsEqual(source.authoritativeCounts, target.authoritativeCounts)) {
            mismatches.push(`${prefix}authoritative-counts`)
        }
        return mismatches
    }

    function summarizeCoordinatorQueueWalAccounting(walStore = null, recovery = {}) {
        const activeGenerationId = walStore?.meta?.activeCheckpoint || recovery?.wal?.generationId || ''
        const records = activeGenerationId ? getWalRecordsForGeneration(walStore, activeGenerationId) : []
        const checkpoints = walStore && typeof walStore === 'object' && walStore.checkpoints && typeof walStore.checkpoints === 'object'
            ? Object.keys(walStore.checkpoints)
            : []
        const generations = walStore && typeof walStore === 'object' && walStore.wal && typeof walStore.wal === 'object'
            ? Object.keys(walStore.wal)
            : []
        const ignored = Array.isArray(recovery?.wal?.projected?.ignored) ? recovery.wal.projected.ignored : []
        const applied = Array.isArray(recovery?.wal?.projected?.applied) ? recovery.wal.projected.applied : []

        return {
            present: !!walStore,
            recovered: recovery?.recovered === true,
            recoveryReason: recovery?.reason || '',
            activeGenerationId,
            checkpointCount: checkpoints.length,
            generationCount: generations.length,
            activeTailRecords: records.length,
            appliedRecords: applied.length,
            ignoredRecords: ignored.length,
            nextSeq: Number.parseInt(walStore?.meta?.nextSeq, 10) || 0
        }
    }

    function makeCoordinatorCurrentWorkAccounting(queue = {}) {
        const counts = makeCoordinatorQueueAccountingCounts(queue).counts
        const ready = Number(counts.queued) || 0
        const active = ['opening', 'active', 'acting', 'settling']
            .reduce((total, status) => total + (Number(counts[status]) || 0), 0)
        const succeeded = Number(counts.succeeded) || 0
        const failed = Number(counts.failed) || 0

        return {
            ready,
            active,
            succeeded,
            failed,
            terminal: Object.entries(counts)
                .filter(([status]) => isTerminalCoordinatorStatus(status))
                .reduce((total, [, count]) => total + (Number(count) || 0), 0)
        }
    }

    return {
        getCoordinatorQueueViewSortRank,
        getCoordinatorQueueViewTime,
        getCoordinatorQueueViewEpochStartedAt,
        isCoordinatorActualBlockSuccess,
        isCoordinatorAlreadyBlockedSuccess,
        getCoordinatorActualBlockTerminalTime,
        getCoordinatorActualBlockActiveStartTime,
        summarizeCoordinatorActualBlockTiming,
        summarizeCoordinatorAlreadyBlockedTiming,
        getCoordinatorActivationHandoffTerminalTime,
        getCoordinatorActivationHandoffActiveTime,
        summarizeCoordinatorActivationHandoffTiming,
        summarizeCoordinatorQueueViewItem,
        buildCoordinatorQueueFromView,
        filterCoordinatorQueueForCompactView,
        buildCoordinatorQueueView,
        makeCoordinatorQueueAccountingCounts,
        normalizeCoordinatorQueueViewAccounting,
        areCoordinatorAccountingCountsEqual,
        makeCoordinatorQueueAccountingComparison,
        summarizeCoordinatorQueueWalAccounting,
        makeCoordinatorCurrentWorkAccounting
    }
}

module.exports = {
    createCoordinatorQueueView
}
