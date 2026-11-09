'use strict'

// Mock model of the owner design. Nothing here imports the repo's code: rows,
// shards, storage, the WAL and the owner protocol are simplified stand-ins, so the
// results show structure (how costs scale, which protocol cases hold), not
// measured Chrome or repo behaviour.
//
//   node experiments/mock-owner/run.js

const crypto = require('node:crypto')

const ROWS = 1000
const SHARDS = Number(process.env.MOCK_SHARDS || 32)
const SESSION_QUOTA_BYTES = 10 * 1024 * 1024
const MUTATIONS = 1000

function fnv1a(text) {
    let hash = 2166136261
    for(let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index)
        hash = Math.imul(hash, 16777619)
    }
    return hash >>> 0
}

const shardOf = key => fnv1a(key) % SHARDS

function makeRow(index) {
    return {
        href: `https://www.quora.com/profile/Mock-${index}`,
        status: ['queued', 'running', 'succeeded'][index % 3],
        runId: `run-${Math.floor(index / 50)}`,
        attemptId: `attempt-${index}`,
        queueSequence: index,
        updatedAt: 1791777600000 + index,
        sources: Array.from({length: 1 + (index % 3)}, (_, sourceIndex) => `source-${(index * 7 + sourceIndex) % 300}`),
        note: crypto.randomBytes(200).toString('hex')
    }
}

// Each derived view keeps one entry per row, sharded by a key. A view's shard is
// the JSON of its entries. Sizes are JSON bytes, as stored in storage.session.
function buildViews(rows) {
    const views = {queue: {}, progress: {}, contentIndex: {}, sourceIndex: {}}
    for(const row of rows) {
        views.queue[row.href] = row
        views.progress[row.href] = {href: row.href, status: row.status, attemptId: row.attemptId}
        views.contentIndex[row.href] = {href: row.href, status: row.status, runId: row.runId}
        for(const source of row.sources) {
            views.sourceIndex[source] = views.sourceIndex[source] || []
            views.sourceIndex[source].push(row.href)
        }
    }
    return views
}

// Maps every view entry to a (view, shard) pair so a commit's touched shards can be counted.
function shardSizes(views) {
    const sizes = {}
    for(const [viewName, entries] of Object.entries(views)) {
        for(let shard = 0; shard < SHARDS; shard += 1) sizes[`${viewName}.${shard}`] = 0
        for(const [key, value] of Object.entries(entries)) {
            sizes[`${viewName}.${shardOf(key)}`] += Buffer.byteLength(JSON.stringify([key, value]))
        }
    }
    return sizes
}

function touchedShards(row) {
    const touched = new Set([
        `queue.${shardOf(row.href)}`,
        `progress.${shardOf(row.href)}`,
        `contentIndex.${shardOf(row.href)}`
    ])
    for(const source of row.sources) touched.add(`sourceIndex.${shardOf(source)}`)
    return touched
}

function percentile(sorted, fraction) {
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]
}

function publicationCost(rows, views) {
    const sizes = shardSizes(views)
    const totalBytes = Object.values(sizes).reduce((sum, value) => sum + value, 0)
    const fullRewritePerCommit = totalBytes

    const perMutationShardBytes = []
    const perMutationShardCount = []
    for(let index = 0; index < MUTATIONS; index += 1) {
        const row = rows[(index * 37) % rows.length]
        const touched = [...touchedShards(row)]
        perMutationShardCount.push(touched.length)
        perMutationShardBytes.push(touched.reduce((sum, name) => sum + sizes[name], 0))
    }
    const sortedBytes = [...perMutationShardBytes].sort((a, b) => a - b)
    const sortedCount = [...perMutationShardCount].sort((a, b) => a - b)
    return {
        totalMirrorBytes: totalBytes,
        totalMirrorKiB: Number((totalBytes / 1024).toFixed(1)),
        sessionQuotaFraction: Number((totalBytes / SESSION_QUOTA_BYTES).toFixed(4)),
        fullRewritePerCommitBytes: fullRewritePerCommit,
        changedShardPerCommit: {
            medianBytes: percentile(sortedBytes, 0.5),
            p95Bytes: percentile(sortedBytes, 0.95),
            maxBytes: sortedBytes[sortedBytes.length - 1],
            medianShards: percentile(sortedCount, 0.5),
            maxShards: sortedCount[sortedCount.length - 1]
        },
        reductionAtMedian: Number((fullRewritePerCommit / percentile(sortedBytes, 0.5)).toFixed(1))
    }
}

// Fan-out sweep: the same row with more sources touches more source-index shards.
function fanOutSweep(rows, views) {
    const sizes = shardSizes(views)
    const sweep = {}
    for(let sources = 1; sources <= 4; sources += 1) {
        const sample = rows.slice(0, 200).map(row => {
            const fake = {...row, sources: Array.from({length: sources}, (_, index) => `source-${row.queueSequence * 13 + index}`)}
            return [...touchedShards(fake)].reduce((sum, name) => sum + sizes[name], 0)
        }).sort((a, b) => a - b)
        sweep[`${sources}SourcesPerRow`] = {medianBytes: percentile(sample, 0.5), p95Bytes: percentile(sample, 0.95)}
    }
    return sweep
}

// Startup handoff: a page reads WAL keys, then passes them to a Worker. Compares
// the copy a structured clone makes with a transfer of an ArrayBuffer. Mock timing
// in Node, not Chrome's postMessage.
function startupHandoff() {
    const keys = {}
    for(let index = 0; index < 141; index += 1) {
        keys[`mbCoordinatorQueueWal.segment.${index}`] = crypto.randomBytes(5800).toString('base64')
    }
    const totalBytes = Object.values(keys).reduce((sum, value) => sum + Buffer.byteLength(value), 0)

    const started = process.hrtime.bigint()
    structuredClone(keys)
    const cloneMs = Number(process.hrtime.bigint() - started) / 1e6

    const encoded = Buffer.from(JSON.stringify(keys))
    const copy = new Uint8Array(encoded)
    const transferStarted = process.hrtime.bigint()
    const transferred = copy.buffer.slice(0)
    const transferMs = Number(process.hrtime.bigint() - transferStarted) / 1e6

    return {
        keys: Object.keys(keys).length,
        payloadKiB: Number((totalBytes / 1024).toFixed(1)),
        structuredCloneMs: Number(cloneMs.toFixed(2)),
        arrayBufferCopyMs: Number(transferMs.toFixed(3)),
        arrayBufferBytes: transferred.byteLength
    }
}

// Owner protocol. Durable storage is a log; each entry records the writer's epoch.
// The fence rejects a write whose epoch is below the last durable writer epoch.
// Cases exercise crashes and handover with an idempotency key on every request.
function makeDurable() {
    return {log: [], lastEpoch: 0, appliedKeys: new Set()}
}

function makeOwner(durable, epoch) {
    return {epoch, durable, crashAfterWrite: false}
}

function ownerApply(owner, request) {
    const durable = owner.durable
    if(owner.epoch < durable.lastEpoch) {
        return {ok: false, reason: 'fenced-stale-epoch'}
    }
    if(durable.appliedKeys.has(request.idempotencyKey)) {
        return {ok: true, reason: 'duplicate-ignored'}
    }
    durable.log.push({key: request.idempotencyKey, mutation: request.mutation, epoch: owner.epoch})
    durable.appliedKeys.add(request.idempotencyKey)
    durable.lastEpoch = owner.epoch
    if(owner.crashAfterWrite) {
        owner.crashAfterWrite = false
        return {ok: false, reason: 'crashed-before-ack'}
    }
    return {ok: true, reason: 'applied'}
}

// The requester retries with the same key until acknowledged, against whichever owner is live.
function requestWithRetry(owners, request, maxAttempts = 5) {
    for(let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const owner = owners.current()
        const reply = ownerApply(owner, request)
        if(reply.ok) return {attempt, reply}
    }
    return {attempt: maxAttempts, reply: {ok: false, reason: 'gave-up'}}
}

function protocolCases() {
    const cases = []
    const check = (name, fn) => {
        try {
            const detail = fn()
            cases.push({name, pass: true, detail})
        }
        catch(error) {
            cases.push({name, pass: false, detail: error.message})
        }
    }
    const count = (durable, key) => durable.log.filter(entry => entry.key === key).length

    check('normal write is applied once', () => {
        const durable = makeDurable()
        let current = makeOwner(durable, 1)
        const owners = {current: () => current}
        const result = requestWithRetry(owners, {idempotencyKey: 'req-1', mutation: {href: 'a'}})
        if(count(durable, 'req-1') !== 1 || !result.reply.ok) throw new Error(`count ${count(durable, 'req-1')}`)
        return `applied in ${result.attempt} attempt, count 1`
    })

    check('owner crash after physical write, before ack: retry applies once', () => {
        const durable = makeDurable()
        let current = makeOwner(durable, 1)
        current.crashAfterWrite = true
        const owners = {current: () => current}
        const first = ownerApply(current, {idempotencyKey: 'req-2', mutation: {href: 'b'}})
        if(first.ok) throw new Error('expected crash')
        current = makeOwner(durable, 2)
        const result = requestWithRetry(owners, {idempotencyKey: 'req-2', mutation: {href: 'b'}})
        if(count(durable, 'req-2') !== 1) throw new Error(`count ${count(durable, 'req-2')}`)
        return `retry on epoch 2 returned ${result.reply.reason}, count 1`
    })

    check('owner crash before physical write: retry applies once', () => {
        const durable = makeDurable()
        let current = makeOwner(durable, 1)
        const owners = {current: () => current}
        // Owner dies before writing: the request is never applied, so the retry applies it.
        current = makeOwner(durable, 2)
        const result = requestWithRetry(owners, {idempotencyKey: 'req-3', mutation: {href: 'c'}})
        if(count(durable, 'req-3') !== 1 || !result.reply.ok) throw new Error(`count ${count(durable, 'req-3')}`)
        return 'applied once on epoch 2'
    })

    check('stale owner is fenced after handover', () => {
        const durable = makeDurable()
        const oldOwner = makeOwner(durable, 1)
        const newOwner = makeOwner(durable, 2)
        ownerApply(newOwner, {idempotencyKey: 'req-4', mutation: {href: 'd'}})
        const late = ownerApply(oldOwner, {idempotencyKey: 'req-5', mutation: {href: 'e'}})
        if(late.ok || late.reason !== 'fenced-stale-epoch') throw new Error(`stale write returned ${late.reason}`)
        if(count(durable, 'req-5') !== 0) throw new Error('stale write reached the log')
        return 'stale write rejected, not in log'
    })

    check('viewer ignores a broadcast from an earlier epoch', () => {
        let maxEpoch = 0
        const accepted = []
        const broadcasts = [{epoch: 2, seq: 1}, {epoch: 1, seq: 900}, {epoch: 2, seq: 2}]
        for(const message of broadcasts) {
            if(message.epoch < maxEpoch) continue
            maxEpoch = message.epoch
            accepted.push(message)
        }
        if(accepted.some(message => message.epoch === 1)) throw new Error('old epoch accepted')
        return `accepted ${accepted.length} of ${broadcasts.length}, none from epoch 1`
    })

    return cases
}

function main() {
    const rows = Array.from({length: ROWS}, (_, index) => makeRow(index))
    const views = buildViews(rows)
    const results = {
        mock: true,
        rows: ROWS,
        shards: SHARDS,
        publication: publicationCost(rows, views),
        fanOut: fanOutSweep(rows, views),
        startupHandoff: startupHandoff(),
        protocol: protocolCases()
    }
    console.log(JSON.stringify(results, null, 2))
}

main()
