// Coordinator-runs materialization functions extracted from sw.js
// (decomposition Slice 16). This is the "run" grouping layer on top of the
// coordinator queue: the empty-milestones builder, the progress-driven
// failure-reset predicate, the run status classifier, the paused-state
// materializer driven by the pause control flag, the run's target-href
// list getter, the work-key/profile-href match predicate, the run-items
// getter, the run-ids-for-href lookup, and the run recompute/materialize
// entry point the reconcile core calls after every queue mutation.
//
// Construction-order note: nothing already constructed earlier in sw.js
// eagerly references any of these 9 function names in its own deps object
// literal (checked via grep across every `create*(` call site's handlers/
// constants object literal before this cluster's old source-text
// position). The only earlier uses of these names in sw.js are inside
// other functions' bodies (called at runtime, not at module-eval time), so
// this module constructs in place at the cluster's old position,
// immediately after swProfileNukeProgress.js's destructure, matching the
// Slice 14/15 precedent.
//
// Every body was grepped for `.then(`, `.catch(`, `Promise.`, `async`, and
// `setTimeout` before moving. None of these 9 functions has any of these.
// recomputeCoordinatorRuns calls runQueueWakeupMetricPhase (an
// already-extracted swQueueWakeupMetricsShape.js function), but only with
// a synchronous callback that returns a plain object, never a Promise --
// runQueueWakeupMetricPhase only awaits/`.finally()`s the callback's
// result when that result is itself thenable, so this call never builds or
// crosses a Promise chain and carries no realm-crossing risk per
// architecture.md's Slice 7 refinement.
//
// Clock note: materializeCoordinatorRunsPausedStateFromControl reads
// Date.now() via a default parameter (`now = Date.now()`), and
// recomputeCoordinatorRuns reads Date.now() inline as a createdAt
// fallback. Both evaluate in the *defining* function's own realm, not the
// caller's, per the Slice 2/12/13/14/15 clock-note precedent. `now` is
// threaded through this module's deps as `() => Date.now()` and both call
// sites use `now()` instead.
//
// cloneCoordinatorAuthorityValue and the createCoordinatorAuthority-adjacent
// region are explicitly out of scope for this decomposition effort (see the
// plan's "Boundary after Slice 17" section) and are untouched here.

function createCoordinatorRuns(deps = {}) {
    const {now} = deps
    const {
        makeEmptyJobMilestones,
        isRetryableCoordinatorFailureFromProgress,
        isTerminalCoordinatorStatus,
        isActiveCoordinatorStatus,
        isPendingCoordinatorStatus,
        isTransientProfileNukeStatus,
        getNormalizedProfileHrefList,
        normalizeQuoraProfileUrl,
        getCoordinatorItemHref,
        getCoordinatorItemQueueKey,
        runQueueWakeupMetricPhase
    } = deps.handlers || {}

    function makeEmptyCoordinatorMilestones() {
        return makeEmptyJobMilestones()
    }

    function shouldResetCoordinatorFailureFromProgress(item = null, record = null, mapped = null) {
        if(!isRetryableCoordinatorFailureFromProgress(item, record)) return false
        if(!mapped || isTerminalCoordinatorStatus(mapped.status)) return false
        if(!isTransientProfileNukeStatus(record?.status)) return false

        const recordRunId = `${record?.runId || ''}`.trim()
        const itemRunId = `${item?.runId || ''}`.trim()
        if(recordRunId && recordRunId !== itemRunId) return true

        const recordUpdatedAt = Number.parseInt(record?.updatedAt, 10) || 0
        const itemTerminalAt = Number.parseInt(item?.terminalAt, 10) || 0
        return recordUpdatedAt > 0 && itemTerminalAt > 0 && recordUpdatedAt >= itemTerminalAt
    }

    function getCoordinatorRunStatus(runItems = [], existingRun = {}) {
        if(!runItems.length) return existingRun?.paused ? 'paused' : 'complete'

        const terminalCount = runItems.filter(item => isTerminalCoordinatorStatus(item?.status)).length
        if(terminalCount === runItems.length) return 'complete'
        if(existingRun?.paused) return 'paused'
        return 'active'
    }

    function materializeCoordinatorRunsPausedStateFromControl(queue = {}, runs = {}, paused = false, nowMs = now()) {
        const nextRuns = {...(runs || {})}
        const targetRunIds = new Set(Object.keys(nextRuns))
        const affectedRunIds = []

        for(const item of Object.values(queue || {})) {
            const runId = `${item?.runId || ''}`.trim()
            if(runId) targetRunIds.add(runId)
        }

        for(const runId of targetRunIds) {
            const run = nextRuns[runId]
            if(!run || typeof run !== 'object') continue

            const runItems = getCoordinatorRunItems(queue, runId, run)
            if(!runItems.some(item => isPendingCoordinatorStatus(item?.status))) continue

            const status = paused ? 'paused' : 'active'
            if(run.paused === paused && `${run.status || ''}` === status) continue

            nextRuns[runId] = {
                ...run,
                paused,
                status,
                updatedAt: Math.max(Number.parseInt(run.updatedAt, 10) || 0, nowMs)
            }
            affectedRunIds.push(runId)
        }

        return {
            changed: affectedRunIds.length > 0,
            runs: affectedRunIds.length ? nextRuns : runs,
            affectedRunIds
        }
    }

    function getCoordinatorRunTargetHrefs(run = {}) {
        return getNormalizedProfileHrefList(run?.targetProfileHrefs || [])
    }

    function isCoordinatorRunWorkKeyForProfileHref(workKey = '', normalizedHref = '') {
        const key = `${workKey || ''}`.trim()
        if(!key || !normalizedHref) return false
        if(key === normalizedHref) return true

        return normalizeQuoraProfileUrl(key) === normalizedHref
    }

    function getCoordinatorRunItems(queue = {}, runId = '', existingRun = {}) {
        const targetHrefs = new Set(getCoordinatorRunTargetHrefs(existingRun))

        return Object.entries(queue || {})
            .filter(([itemKey, item]) => {
                if(item?.runId === runId) return true
                if(!targetHrefs.size) return false

                const href = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(itemKey)
                return !!href && targetHrefs.has(href)
            })
            .map(([, item]) => item)
    }

    function getCoordinatorRunIdsForHref(runs = {}, href = '') {
        const normalizedHref = normalizeQuoraProfileUrl(href)
        if(!normalizedHref) return []

        return Object.values(runs || {})
            .filter(run => {
                if(getCoordinatorRunTargetHrefs(run).includes(normalizedHref)) return true

                return (Array.isArray(run?.targetWorkKeys) ? run.targetWorkKeys : [])
                    .some(key => isCoordinatorRunWorkKeyForProfileHref(key, normalizedHref))
            })
            .map(run => run?.id || run?.runId || '')
            .filter(Boolean)
    }

    function recomputeCoordinatorRuns(queue = {}, runs = {}, runIds = null) {
        return runQueueWakeupMetricPhase('recomputeRuns', () => {
            const nextRuns = {
                ...runs
            }
            const targetRunIds = new Set(runIds || Object.keys(nextRuns))

            for(const item of Object.values(queue || {})) {
                if(item?.runId && (!runIds || targetRunIds.has(item.runId))) {
                    targetRunIds.add(item.runId)
                }
            }

            for(const runId of targetRunIds) {
                const existing = nextRuns[runId] || {
                    id: runId,
                    sourcePages: []
                }
                const runItems = getCoordinatorRunItems(queue, runId, existing)
                const targetHrefs = new Set(getCoordinatorRunTargetHrefs(existing))
                const targetWorkKeys = new Set(Array.isArray(existing.targetWorkKeys) ? existing.targetWorkKeys : [])
                const sourcePages = new Set(Array.isArray(existing.sourcePages) ? existing.sourcePages : [])
                for(const item of runItems) {
                    const href = getCoordinatorItemHref(item)
                    const workKey = getCoordinatorItemQueueKey(item) || href
                    const sourcePageUrl = `${item?.source?.pageUrl || item?.source?.sourcePageUrl || ''}`.trim()
                    if(href) targetHrefs.add(href)
                    if(workKey) targetWorkKeys.add(workKey)
                    if(sourcePageUrl) sourcePages.add(sourcePageUrl)
                }
                const targetProfileHrefs = Array.from(targetHrefs)
                const targetWorkKeyList = Array.from(targetWorkKeys)
                const terminalCount = runItems.filter(item => isTerminalCoordinatorStatus(item?.status)).length
                const activeCount = runItems.filter(item => isActiveCoordinatorStatus(item?.status)).length
                const latestItemUpdatedAt = runItems.reduce((latest, item) => {
                    const updatedAt = Number.parseInt(item?.updatedAt || item?.terminalAt || item?.createdAt, 10) || 0
                    return Math.max(latest, updatedAt)
                }, 0)

                nextRuns[runId] = {
                    ...existing,
                    id: runId,
                    sourceType: existing.sourceType || runItems[0]?.source?.type || 'space-feed',
                    createdAt: existing.createdAt || runItems[0]?.createdAt || now(),
                    sourcePages: Array.from(sourcePages),
                    targetProfileHrefs,
                    targetWorkKeys: targetWorkKeyList,
                    itemCount: targetProfileHrefs.length || runItems.length || targetWorkKeyList.length || 0,
                    activeCount,
                    terminalCount,
                    status: getCoordinatorRunStatus(runItems, existing),
                    updatedAt: Math.max(Number.parseInt(existing.updatedAt, 10) || 0, latestItemUpdatedAt)
                }
            }

            return nextRuns
        })
    }

    return {
        makeEmptyCoordinatorMilestones,
        shouldResetCoordinatorFailureFromProgress,
        getCoordinatorRunStatus,
        materializeCoordinatorRunsPausedStateFromControl,
        getCoordinatorRunTargetHrefs,
        isCoordinatorRunWorkKeyForProfileHref,
        getCoordinatorRunItems,
        getCoordinatorRunIdsForHref,
        recomputeCoordinatorRuns
    }
}

module.exports = {
    createCoordinatorRuns
}
