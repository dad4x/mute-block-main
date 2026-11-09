// Pages through a Quora Blocked Users list and reports progress as it goes. Environment-neutral: it has no require and no globals
// except the export, so the same code can run in Node (through CDP) or in an extension page.
//
// deps:
//   fetchPage(after)        -> {status, edges, hasNextPage, endCursor}  on success, or {status, error, head} on failure (or a throw)
//   sleep(ms)               -> Promise
//   saveCheckpoint(state)   -> optional; called every checkpointEvery pages and at the end
// options:
//   resume                  -> {cursor, pages, rows, failures} from an earlier checkpoint, or null
//   onProgress(event)       -> optional; called for every page, every retry, every heartbeat while waiting, and at the end
//   pageSize, maxAttempts, checkpointEvery, maxPages, heartbeatMs
//
// Events (all carry pages, rows and retries):
//   {type: 'start' | 'resume'}
//   {type: 'page', endCursor}
//   {type: 'retry', after, attempt, status, error, head, waitMs}
//   {type: 'waiting', secondsLeft}            every heartbeatMs while backing off, so a caller knows the run is alive
//   {type: 'done' | 'failed', end, elapsedMs}
// Result: {end, pages, rows, failures, distinctUids, duplicateRows, notBlockedFlagRows}

(function (root) {
    const DEFAULTS = {pageSize: 10, maxAttempts: 8, checkpointEvery: 25, maxPages: 5000, heartbeatMs: 1000}

    async function collectBlockedList(deps, options = {}) {
        const cfg = {...DEFAULTS, ...options}
        const emit = options.onProgress || (() => {})
        const save = deps.saveCheckpoint || (() => {})
        const startedAt = Date.now()
        let rows = []
        let failures = []
        let after = null
        let pages = 0
        const counts = () => ({pages, rows: rows.length, retries: failures.length})

        if (options.resume) {
            rows = options.resume.rows.slice()
            failures = options.resume.failures.slice()
            after = options.resume.cursor
            pages = options.resume.pages
            emit({type: 'resume', ...counts(), cursor: after})
        }
        else emit({type: 'start', ...counts()})

        let end = null
        for (;;) {
            let reply = null
            for (let attempt = 0; attempt < cfg.maxAttempts && !reply; attempt += 1) {
                let r = null
                try { r = await deps.fetchPage(after) }
                catch (error) { r = {status: 0, error: String(error && error.message || error)} }
                if (r && !r.error) { reply = r; break }
                const waitMs = Math.min(60000, (attempt + 1) * 5000)
                failures.push({after, attempt, status: r?.status ?? 0, error: r?.error || 'unknown', head: r?.head || null})
                emit({type: 'retry', after, attempt, status: r?.status ?? 0, error: r?.error || 'unknown', head: r?.head || null, waitMs, ...counts()})
                let remaining = waitMs
                while (remaining > 0) {
                    const step = Math.min(cfg.heartbeatMs, remaining)
                    await deps.sleep(step)
                    remaining -= step
                    emit({type: 'waiting', secondsLeft: Math.ceil(remaining / 1000), ...counts()})
                }
            }
            if (!reply) { end = 'failed-after-retries'; break }
            pages += 1
            for (const edge of reply.edges) rows.push(edge)
            after = reply.endCursor
            emit({type: 'page', endCursor: after, ...counts()})
            if (pages % cfg.checkpointEvery === 0) save({cursor: after, pages, rows: rows.slice(), failures: failures.slice(), finished: false})
            if (!reply.hasNextPage) { end = 'hasNextPage=false'; break }
            if (pages >= cfg.maxPages) { end = 'max-pages-guard'; break }
        }

        const distinct = new Set(rows.map(r => r.uid)).size
        const result = {
            end,
            pages,
            rows,
            failures,
            distinctUids: distinct,
            duplicateRows: rows.length - distinct,
            notBlockedFlagRows: rows.filter(r => r.blockedFlag !== true).length
        }
        save({cursor: after, pages, rows: rows.slice(), failures: failures.slice(), finished: end === 'hasNextPage=false'})
        emit({type: end === 'hasNextPage=false' ? 'done' : 'failed', end, elapsedMs: Date.now() - startedAt, ...counts()})
        return result
    }

    const api = {collectBlockedList, DEFAULTS}
    if (typeof module !== 'undefined' && module.exports) module.exports = api
    else root.QuoraBlockedListCore = api
})(typeof globalThis !== 'undefined' ? globalThis : this)
