// WAL-layer store for the coordinator queue (docs/queue-storage-layering.md, Phase 6 move).
//
// Owns the resident WAL store (the last store this process hydrated, durably wrote or recovered) and the WAL
// store load that fills it. The design notes for why the resident copy exists, and when it may be used, are in
// sw.js above the declaration this module replaced. The WAL primitives come straight from walSnapshotStore.js.
// Everything else the load needs lives in sw.js or in a factory closure (the metric counters, diagnostics, the
// quota check, checkpoint scheduling, the constants, and the normalisers), so it is injected. sw.js wraps each
// injected function so the name is looked up when it is called. The load reads storage only through the injected
// metricStorageGet and keeps every await where it was: callers depend on its tick count (see
// loadCoordinatorQueueWalProjection in sw.js).

const {
    CHECKPOINT_A,
    CHECKPOINT_B,
    CHECKPOINT_MANIFEST_META_MISMATCH,
    checkpointManifestMatchesMeta,
    getCheckpointFingerprint,
    getSegmentedWalCheckpointKey,
    getSegmentedWalCheckpointShardKeysForMeta,
    getAreaShardSupersetKeys,
    getArrivalShardKeysMissingFromStored,
    getSegmentedWalSegmentKey,
    getSegmentedWalCommittedSegmentCount,
    isSegmentedWalStorageMeta,
    normalizeCheckpointId,
    normalizeCheckpointShardCount,
    hydrateSegmentedWalStore,
    readStoredCheckpoint,
    verifyCheckpoint,
    writeInactiveCheckpoint,
    CHECKPOINT_SHARD_FORMAT,
    getSegmentedWalCheckpointShardKey,
    getSegmentedWalMetaKey,
    getQueueMirrorShardIds,
    countNonQueueShardKeys,
    CHECKPOINT_AREA_NAMESPACES,
    getCheckpointShardKeyNamespace,
    getNonQueueAreaShardSupersetKeys,
    getQueueAreaDisagreement,
    storedNamesNonQueueCheckpointShards
} = require('./walSnapshotStore')

// The diagnostic and flight recorder kinds of the checkpoint binding (loadStoreFromStorage below), named once.
const CHECKPOINT_MISMATCH_EVENT = 'coordinator-authority-queue-wal-checkpoint-mismatch'
const CHECKPOINT_RECOVERED_EVENT = 'coordinator-authority-queue-wal-checkpoint-recovered-from-mirror'
const CHECKPOINT_MISMATCH_FLIGHT_KIND = 'queue-wal-checkpoint-mismatch'
const CHECKPOINT_RECOVERED_FLIGHT_KIND = 'queue-wal-checkpoint-recovered-from-mirror'
// The record of a mirror rebuild that keeps its session copy instead of copying a manifest that disagrees with the disk meta
// (rebuildCoordinatorQueueMirrorFromDisk in sw.js). It names the same kinds of fact as the mismatch event.
const MIRROR_REBUILD_SKIPPED_EVENT = 'coordinator-authority-queue-wal-mirror-rebuild-skipped'
const MIRROR_REBUILD_SKIPPED_FLIGHT_KIND = 'queue-wal-mirror-rebuild-skipped'

function createQueueWalStore(deps = {}) {
    const {
        constants = {},
        metrics = {},
        diagnostics = {},
        storage = {},
        mirror = {},
        checkpoints = {},
        authority = {}
    } = deps
    const {
        COORDINATOR_QUEUE_WAL_KEY,
        COORDINATOR_QUEUE_WAL_META_KEY,
        COORDINATOR_QUEUE_WAL_HYDRATE_ATTEMPTS,
        COORDINATOR_QUEUE_WAL_SEGMENT_HARD_LIMIT,
        COORDINATOR_QUEUE_WAL_ATOMIC_READ_SEGMENT_SUPERSET,
        COORDINATOR_QUEUE_WAL_CHECKPOINT_SHARD_COUNT,
        COORDINATOR_QUEUE_WAL_SEGMENT_SOFT_SWITCH_AT,
        // The codec the snapshots are written with. Without it a codec-encoded copy cannot be decoded, so it is refused.
        COORDINATOR_QUEUE_WAL_SNAPSHOT_CODEC_OPTIONS = {}
    } = constants
    const {
        incrementQueueWakeupMetric,
        recordQueueWakeupMetricMax,
        runQueueWakeupMetricPhase
    } = metrics
    const {recordCoordinatorDiagnosticEvent, recordFlightRecorderEvent} = diagnostics
    const {metricStorageGet} = storage
    const {readCheckpointKeys: readMirrorCheckpointKeys} = mirror
    const {
        scheduleSwitch: scheduleCoordinatorQueueWalCheckpointSwitch,
        checkQuotaHealth: maybeCheckCoordinatorStorageQuotaHealth
    } = checkpoints
    const {
        normalizeMap: normalizeCoordinatorMap,
        makeCheckpoint: makeCoordinatorQueueWalCheckpoint,
        normalizeStore: normalizeCoordinatorQueueWalStore,
        canUseResidentForMeta: canUseResidentCoordinatorQueueWalStoreForMeta
    } = authority
    const injected = {
        incrementQueueWakeupMetric,
        recordQueueWakeupMetricMax,
        runQueueWakeupMetricPhase,
        recordCoordinatorDiagnosticEvent,
        recordFlightRecorderEvent,
        readMirrorCheckpointKeys,
        metricStorageGet,
        scheduleCoordinatorQueueWalCheckpointSwitch,
        maybeCheckCoordinatorStorageQuotaHealth,
        normalizeCoordinatorMap,
        makeCoordinatorQueueWalCheckpoint,
        normalizeCoordinatorQueueWalStore,
        canUseResidentCoordinatorQueueWalStoreForMeta
    }
    for (const name of Object.keys(injected)) {
        if (typeof injected[name] !== 'function') throw new Error('Missing queue WAL store dependency: ' + name)
    }

    // The resident copy. Only this module writes it; sw.js reads it through resident.get().
    let residentStore = null

    // The checkpoint slots as storage holds them, as this process knows it (checkpoint reuse, step 2). For each slot: the shard identities
    // (index and content hash) of its manifest, when the manifest matches the meta and every shard record was in the same read; null when
    // that is not known. It is recorded from storage at each load, and from each save that succeeds. The worker trusts this record,
    // because nothing else writes these keys. A removal of the meta or a checkpoint key forgets both slots, as a storage clear does, and so
    // does a save that did not succeed.
    let rememberedSlots = {[CHECKPOINT_A]: null, [CHECKPOINT_B]: null}

    function getShardIdentities(checkpoint = null) {
        return (checkpoint?.shards || []).map(shard => ({index: shard.index, shardStateHash: shard.shardStateHash}))
    }

    function rememberCheckpointSlotsFromRead(stored = {}, meta = null) {
        for(const checkpointId of [CHECKPOINT_A, CHECKPOINT_B]) {
            rememberedSlots[checkpointId] = null
            const manifest = stored?.[getSegmentedWalCheckpointKey(COORDINATOR_QUEUE_WAL_KEY, checkpointId)] || null
            const metaCheckpoint = meta?.checkpoints?.[checkpointId] || null
            if(!manifest || manifest.format !== CHECKPOINT_SHARD_FORMAT || !metaCheckpoint) continue
            if(!checkpointManifestMatchesMeta(manifest, metaCheckpoint, checkpointId)) continue
            const shards = Array.isArray(manifest.shards) ? manifest.shards : []
            if(shards.length !== normalizeCheckpointShardCount(manifest.shardCount)) continue
            const everyShardPresent = shards.every(shard =>
                stored?.[getSegmentedWalCheckpointShardKey(COORDINATOR_QUEUE_WAL_KEY, checkpointId, shard.index)])
            if(!everyShardPresent) continue
            rememberedSlots[checkpointId] = getShardIdentities(manifest)
        }
    }

    function forgetCheckpointSlots() {
        rememberedSlots = {[CHECKPOINT_A]: null, [CHECKPOINT_B]: null}
    }

    // Removing the meta or a checkpoint key (the manifest or a shard) forgets both slots, and a storage clear removes them. Segments are not
    // checked: the switch removes its own retired segments, and that does not change a slot.
    function noteStorageRemovals(changes = {}) {
        const metaKey = getSegmentedWalMetaKey(COORDINATOR_QUEUE_WAL_KEY)
        const checkpointPrefix = `${COORDINATOR_QUEUE_WAL_KEY}.checkpoint.`
        for(const [key, change] of Object.entries(changes || {})) {
            if(change?.newValue !== undefined) continue
            if(key !== metaKey && !key.startsWith(checkpointPrefix)) continue
            forgetCheckpointSlots()
            incrementQueueWakeupMetric('coordinatorAuthority.queueWal.checkpointSlotsForgotten')
            return
        }
    }

    // The checkpoint switch's write into the inactive slot. Shards the slot already holds are left out of the plan, and the caller
    // passes the plan on unread.
    function prepareCheckpointWrite(storedWal = {}, state = {}, options = {}) {
        return writeInactiveCheckpoint(storedWal, state, {...options, rememberedSlots: {...rememberedSlots}})
    }

    // A save that reported success: storage now holds the prepared slot, with the shards its checkpoint lists.
    function noteCheckpointSaved(prepared = null) {
        const slot = prepared?.checkpointId
        if(!slot) return
        rememberedSlots = {
            ...rememberedSlots,
            [slot]: prepared.checkpoint?.format === CHECKPOINT_SHARD_FORMAT ? getShardIdentities(prepared.checkpoint) : null
        }
    }

    // A save that did not succeed leaves storage unknown, so both slots are forgotten.
    function noteCheckpointSaveFailed() {
        forgetCheckpointSlots()
    }

    // Populates coordinatorQueueWalResidentStoreCache (see its declaration
    // above) from a store this process just read or wrote. `store` is whatever
    // this call site already has in hand -- never re-read for this purpose --
    // so this costs nothing extra.
    //
    // Deliberately skips caching a store whose active checkpoint has zero
    // committed WAL segments: a checkpoint with nothing layered on top of it
    // yet is exactly the case where the atomic read this cache exists to skip
    // is already cheap (a small meta + one checkpoint blob, not 35+ segment
    // reads), so there's little to gain -- and it's the case
    // canUseResidentCoordinatorQueueWalStoreForMeta struggles most to fingerprint
    // safely, since a checkpoint-only store's nextSeq/activeCheckpoint/segment-
    // count baseline looks identical regardless of what state it was actually
    // built from (only checkpoints[id].stateHash differs). Restricting the
    // cache to stores with real accumulated WAL activity keeps it out of that
    // ambiguous territory entirely, for the cases where skipping the read
    // actually matters.
    function setResidentStore(store = null) {
        if(!store || typeof store !== 'object') {
            residentStore = null
            return
        }
        const activeCheckpoint = store.meta?.activeCheckpoint || ''
        residentStore = getSegmentedWalCommittedSegmentCount(store.meta, activeCheckpoint) > 0
            ? store
            : null
    }

    // Same idea as setCoordinatorQueueWalResidentStoreCache, but for a store
    // that was just durably written rather than just read: `store` here is the
    // caller's own in-memory result of a mutation (append/checkpoint-activate),
    // whose `.meta` was updated incrementally in place and is NOT guaranteed to
    // carry the same `segmentedStorage.committedSegments` bookkeeping that only
    // gets (re)computed when the physical storage payload is actually built
    // (buildSegmentedWalStoragePayload's makeSegmentedWalStorageMeta). Caching
    // `store.meta` as-is here risks the cache privately disagreeing with the
    // meta this same write just put in storage -- the exact meta that a later
    // hydrate's `staleMeta` will read back. Substituting the payload's own meta
    // key removes that risk: the cached store's meta is then, by construction,
    // identical to what's now durably in storage.
    function cacheFromWrite(store = null, payload = {}) {
        const writtenMeta = payload?.[COORDINATOR_QUEUE_WAL_META_KEY]
        if(!store || typeof store !== 'object' || !writtenMeta) return
        setResidentStore({...store, meta: writtenMeta})
    }

    const resident = {
        get() {
            return residentStore
        },
        set: setResidentStore,
        clear() {
            residentStore = null
        }
    }

    // The disk checkpoint of the active slot is intact when its manifest agrees with the disk meta and the checkpoint verifies from the
    // disk records (every shard decodes to its hash, every area hash of an area-v1 manifest matches, and the state hash matches). It is
    // decided from disk alone: the session copy is not read to decide it. A manifest with no meta entry cannot be bound to the meta,
    // so it is not intact.
    function diskCheckpointIntact(stored = {}, meta = {}, active = CHECKPOINT_A) {
        const manifest = stored?.[getSegmentedWalCheckpointKey(COORDINATOR_QUEUE_WAL_KEY, active)] || null
        const metaCheckpoint = meta?.checkpoints?.[active] || null
        if(!manifest || typeof manifest !== 'object' || !metaCheckpoint) return false
        if(!checkpointManifestMatchesMeta(manifest, metaCheckpoint, active)) return false
        const read = readStoredCheckpoint(stored, COORDINATOR_QUEUE_WAL_KEY, active)
        if(!read.ok || !read.checkpoint) return false
        return verifyCheckpoint(read.checkpoint, COORDINATOR_QUEUE_WAL_SNAPSHOT_CODEC_OPTIONS).ok === true
    }

    // Hydrates a candidate store and verifies its active checkpoint: every shard decodes to its own hash, the area hashes of an area-v1
    // manifest match, and the state hash matches. The one check both recovery paths use (Recovery A and the queue shard fallback).
    // Returns {ok, reason, hydrated}; hydrated is set only when ok. It makes no storage read and no extra await.
    function hydrateVerifiedCheckpoint(candidate, active) {
        const hydrated = runQueueWakeupMetricPhase('queueWalHydrate', () => hydrateSegmentedWalStore(candidate, {
            baseKey: COORDINATOR_QUEUE_WAL_KEY,
            fallbackStore: candidate[COORDINATOR_QUEUE_WAL_KEY] || null
        }))
        if(hydrated?.ok !== true || !hydrated.store) return {ok: false, reason: hydrated?.reason || 'hydrate-failed', hydrated: null}
        const verification = verifyCheckpoint(hydrated.store.checkpoints?.[active], COORDINATOR_QUEUE_WAL_SNAPSHOT_CODEC_OPTIONS)
        if(!verification.ok) return {ok: false, reason: verification.reason, hydrated: null}
        return {ok: true, reason: '', hydrated}
    }

    // The queue shard fallback (owner decision, 27 Oct; architecture.md, section 4.8). Called from loadStoreFromStorage only when the disk read
    // named one QUEUE shard of the active slot as missing or as failing its identity (tornKey). The session copy's record for that key is read
    // in one await, put in place of the disk record, and verified by hydrateVerifiedCheckpoint against the disk manifest. It is used only when
    // that verifies. Returns {hydrated, copy} when used, or null when refused, and the caller then fails closed as before. Completed and runs
    // shards never come here. Nothing is written back to disk.
    async function recoverQueueShardFromSession(stored, meta, tornKey) {
        const active = normalizeCheckpointId(meta.activeCheckpoint)
        const copy = await readMirrorCheckpointKeys([tornKey])
        const copied = copy?.[tornKey] ?? null
        const verified = copied ? hydrateVerifiedCheckpoint({...stored, [tornKey]: copied}, active) : {ok: false}
        if(!verified.ok) {
            incrementQueueWakeupMetric('coordinatorAuthority.queueWal.queueShardFromSessionRefused')
            return null
        }
        incrementQueueWakeupMetric('coordinatorAuthority.queueWal.queueShardRecoveredFromSession')
        return {hydrated: verified.hydrated, copy: {[tornKey]: copied}}
    }

    // Recovery A of the checkpoint binding (docs/queue-storage-layering.md, section 6; architecture.md, section 4.8). The rule is disk
    // first. The session mirror holds the worker's own copy of the active checkpoint: its manifest and shard records, written with the
    // mirror. The copy is the fallback, used only when the disk checkpoint of the active slot is torn (the disk manifest disagrees with
    // the disk meta). When the disk checkpoint is intact, the copy is refused and not read, so a consistent copy never replaces an
    // intact disk manifest. The copy is a candidate, and it is never trusted by itself. It is used only when checkpointManifestMatchesMeta
    // holds for it against the disk meta, and its checkpoint verifies (every shard decodes to its own hash, the area hashes of an area-v1
    // manifest, the queue area among them, and the state hash). Then hydrate runs on a store built from it, and that checks each shard's
    // identity against the copy's manifest. A copy that fails any check is not used. Returns hydrated (ok only when the copy was used),
    // copy (the keys to put into stored, when it was used), and mismatch (the facts the diagnostics record, and what happened to the copy).
    async function recoverCheckpointFromMirror(stored, meta) {
        const active = normalizeCheckpointId(meta.activeCheckpoint)
        const metaCheckpoint = meta.checkpoints?.[active] || null
        const manifestKey = getSegmentedWalCheckpointKey(COORDINATOR_QUEUE_WAL_KEY, active)
        const shardKeys = getSegmentedWalCheckpointShardKeysForMeta(meta, COORDINATOR_QUEUE_WAL_KEY, active)
        const diskManifest = stored?.[manifestKey] || {}
        const mismatch = {
            checkpointId: active,
            metaFingerprint: getCheckpointFingerprint(metaCheckpoint || {}, active),
            manifestFingerprint: getCheckpointFingerprint(diskManifest, normalizeCheckpointId(diskManifest.id)),
            mirror: 'none',
            copyFingerprint: ''
        }
        // Disk first: an intact disk checkpoint is never replaced, and the copy is not read.
        if(diskCheckpointIntact(stored, meta, active)) {
            incrementQueueWakeupMetric('coordinatorAuthority.queueWal.checkpointMirrorCopyRefusedDiskIntact')
            mismatch.mirror = 'refused (disk intact)'
            return {hydrated: null, copy: null, mismatch}
        }
        const keys = [manifestKey, ...shardKeys]
        const copy = await readMirrorCheckpointKeys(keys)
        const copyManifest = copy?.[manifestKey] || null
        if(!copyManifest || typeof copyManifest !== 'object') return {hydrated: null, copy: null, mismatch}

        const copyFingerprint = getCheckpointFingerprint(copyManifest, normalizeCheckpointId(copyManifest.id))
        if(!metaCheckpoint || !checkpointManifestMatchesMeta(copyManifest, metaCheckpoint, active)) {
            incrementQueueWakeupMetric('coordinatorAuthority.queueWal.checkpointMirrorCopyRejected')
            mismatch.mirror = `rejected (fingerprint ${copyFingerprint})`
            return {hydrated: null, copy: null, mismatch}
        }

        // The session copy holds the queue's shards only, when its manifest is area-v1 (the mirror key set, walSnapshotStore.js). The
        // completed and runs shards it does not hold are read from disk under the same keys, so the copy is still a whole checkpoint. A
        // shared-layout copy holds every shard, so it reads nothing from disk, as it always did.
        const copyQueueIds = getQueueMirrorShardIds(copyManifest)
        const copyHeldKeys = new Set(copyQueueIds
            ? copyQueueIds.map(id => getSegmentedWalCheckpointShardKey(COORDINATOR_QUEUE_WAL_KEY, active, id))
            : shardKeys)
        const diskOnlyKeys = shardKeys.filter(key => !copyHeldKeys.has(key))
        const fromDisk = diskOnlyKeys.length
            ? await metricStorageGet(Object.fromEntries(diskOnlyKeys.map(key => [key, null])), {
                metricPath: 'coordinatorAuthority.queueWal.checkpointMirrorDiskShards',
                phase: 'queueWalCheckpointMirrorDiskShards'
            })
            : {}
        const copyKeys = Object.fromEntries(keys.map(key => [key, copyHeldKeys.has(key) || key === manifestKey
            ? copy[key] ?? null
            : fromDisk[key] ?? null]))
        // Hydrate, then the state hash check (hole 2): the copy's shards must decode and each match its own hash, and the merged state must
        // hash to the manifest's stateHash. The same check serves the queue shard fallback (recoverQueueShardFromSession).
        const verified = hydrateVerifiedCheckpoint({...stored, ...copyKeys}, active)
        if(!verified.ok) {
            incrementQueueWakeupMetric('coordinatorAuthority.queueWal.checkpointMirrorCopyRejected')
            mismatch.mirror = `unusable (${verified.reason}, fingerprint ${copyFingerprint})`
            return {hydrated: null, copy: null, mismatch}
        }
        mismatch.mirror = 'used'
        mismatch.copyFingerprint = copyFingerprint
        return {hydrated: verified.hydrated, copy: copyKeys, mismatch}
    }

    // The session restart candidate (architecture.md, section 4.8). Called before the disk read, on the copy the hydrate read put into
    // stored. The copy is a candidate when its active manifest is area-v1, agrees with the copy's own meta, and the copy holds every
    // queue shard that manifest names and every committed segment of the active slot. Returns null otherwise: the load then reads
    // the whole WAL from disk. Returns {active, manifest, committed}, the facts the decision is made against.
    function getSessionRestartCandidate(stored = {}, sessionMeta = null) {
        const active = normalizeCheckpointId(sessionMeta.activeCheckpoint)
        const manifest = stored?.[getSegmentedWalCheckpointKey(COORDINATOR_QUEUE_WAL_KEY, active)] || null
        // getQueueMirrorShardIds is null for a manifest that is not area-v1, so a shared-layout copy is never a session candidate.
        const queueIds = getQueueMirrorShardIds(manifest)
        const metaCheckpoint = sessionMeta.checkpoints?.[active] || null
        if (!queueIds || !metaCheckpoint || !checkpointManifestMatchesMeta(manifest, metaCheckpoint, active)) return null
        const committed = getSegmentedWalCommittedSegmentCount(sessionMeta, active)
        const queueShardsHeld = queueIds.every(id => stored[getSegmentedWalCheckpointShardKey(COORDINATOR_QUEUE_WAL_KEY, active, id)] != null)
        const segmentsHeld = Array.from({length: committed}, (_, segmentNo) => segmentNo)
            .every(segmentNo => stored[getSegmentedWalSegmentKey(COORDINATOR_QUEUE_WAL_KEY, active, segmentNo)] != null)
        if (!queueShardsHeld || !segmentsHeld) return null
        return {active, manifest, committed}
    }

    // The session restart decision, made on the disk read (the same snapshot as the manifests and the meta it compares). The copy
    // is used only when the disk meta names the same active slot, the disk manifest matches the disk meta, the queue areas of the two
    // manifests agree (getQueueAreaDisagreement), and the disk has not fewer committed segments than the copy. Then the copy's queue
    // shards and segments are the queue state, and the disk segments from the copy's committed count on are the tail. Returns
    // {ok, reason, tailFrom, tailTo}; tailFrom and tailTo are segment numbers of the active slot, [tailFrom, tailTo) to read from disk.
    function decideSessionRestart(stored = {}, candidate = null) {
        const diskMeta = stored?.[COORDINATOR_QUEUE_WAL_META_KEY] || null
        if (!isSegmentedWalStorageMeta(diskMeta)) return {ok: false, reason: 'disk-meta-missing'}
        const active = candidate.active
        if (normalizeCheckpointId(diskMeta.activeCheckpoint) !== active) return {ok: false, reason: 'active-slot-differs'}
        const diskManifest = stored[getSegmentedWalCheckpointKey(COORDINATOR_QUEUE_WAL_KEY, active)] || null
        const diskMetaCheckpoint = diskMeta.checkpoints?.[active] || null
        if (!diskManifest || !diskMetaCheckpoint || !checkpointManifestMatchesMeta(diskManifest, diskMetaCheckpoint, active)) {
            return {ok: false, reason: 'disk-manifest-meta-mismatch'}
        }
        const areaReason = getQueueAreaDisagreement(candidate.manifest, diskManifest)
        if (areaReason) return {ok: false, reason: areaReason}
        const diskCommitted = getSegmentedWalCommittedSegmentCount(diskMeta, active)
        if (diskCommitted < candidate.committed) return {ok: false, reason: 'disk-behind-session-copy'}
        return {ok: true, reason: '', tailFrom: candidate.committed, tailTo: diskCommitted}
    }

    async function loadStoreFromStorage(stored = {}, snapshotQueue = {}, options = {}) {
        const staleMeta = stored?.[COORDINATOR_QUEUE_WAL_META_KEY] || null
        if(isSegmentedWalStorageMeta(staleMeta)) {
            // No caller has ever actually populated stored[COORDINATOR_QUEUE_WAL_KEY]
            // with a genuine previously-hydrated store (see
            // coordinatorQueueWalResidentStoreCache's declaration comment above)
            // -- it falls back to our own cache of the last store this process
            // itself hydrated or durably wrote, which is what actually makes
            // canUseResidentCoordinatorQueueWalStoreForMeta's check meaningful.
            const residentStore = stored?.[COORDINATOR_QUEUE_WAL_KEY] || resident.get() || null
            if(canUseResidentCoordinatorQueueWalStoreForMeta(residentStore, staleMeta)) {
                incrementQueueWakeupMetric('coordinatorAuthority.queueWal.residentStoreUsed')
                // Every other branch below mirrors its result back into the
                // caller's own `stored` object before returning (that's how
                // callers building a coordinatorAuthority snapshot payload from
                // `stored` -- e.g. refreshResidentCoordinatorAuthorityState --
                // learn a WAL store is present at all). This fast path returned
                // early without doing that, so a cache hit silently looked to
                // those callers like "no WAL data here", routing them into the
                // raw-queue-reseed fallback with stale pre-mutation data instead
                // of the resident store this cache exists to serve.
                stored[COORDINATOR_QUEUE_WAL_KEY] = residentStore
                return residentStore
            }

            // 2026-09-15 atomic-read fix for the "missing-segment" hydrate-failure
            // storm (see the comment on COORDINATOR_QUEUE_WAL_ATOMIC_READ_SEGMENT_SUPERSET
            // above): the caller's `staleMeta` was fetched separately (and
            // earlier) than this function runs, so trusting it to decide which
            // segment keys "should" exist -- and fetching exactly those, in a
            // SEPARATE later call -- left a real await gap where a concurrent
            // checkpoint switch or auto-recovery rewrite could retire/replace
            // those keys before the second read landed. This function no longer
            // does that: it fetches meta + BOTH checkpoints + a generous superset
            // of segment keys in ONE metricStorageGet call, which is one
            // chrome.storage.local.get() resolving from a single consistent
            // point-in-time snapshot. `staleMeta` is used only to GUESS which
            // checkpoint is active and how many segments to ask for -- sizing
            // hints, never ground truth. The meta this function actually hydrates
            // against is whatever comes back from THIS read (re-read fresh below,
            // and again inside hydrateSegmentedWalStore itself).
            // 2026-10-03: chrome.storage.local has no cross-key transaction
            // guarantee (see the 2026-09-15 comment below this block) -- a
            // checkpoint-switch write touches meta + the new checkpoint +
            // segments in one metricStorageSet call, but a concurrent reader can
            // still observe them becoming visible non-atomically, seeing fresh
            // meta pointing at a checkpoint whose own key hasn't landed yet
            // ("missing-checkpoint") or a committed-segment count ahead of the
            // segment data itself ("missing-segment"). Confirmed live
            // (2026-10-01/03): 6-9 of these per ~20-minute run, previously
            // invisible because they silently self-healed via
            // legacy queue-view snapshot (since retired) -- now that nothing persists that view to disk any more
            // (see the 2026-10-01/02 removal above), every one of them used to
            // surface as a thrown error the caller had to retry from scratch,
            // 500ms+ later, behind whatever storage backlog existed at the time.
            // A torn cross-key write is typically a sub-millisecond window, so
            // one immediate same-call retry (a second real read, not a cached
            // one) is enough to absorb it in place almost every time, without
            // waiting on a caller's own retry/backoff cycle. Bounded at 2 total
            // attempts -- this is a transient-race mitigation, not a substitute
            // for the genuine-corruption handling below, which still runs
            // unchanged if both attempts fail.
            let hydrated = null
            let meta = staleMeta
            // The session restart (architecture.md, section 4.8). sessionRestart is the candidate until a read refuses it; sessionTail is the
            // decision of the attempt that succeeds, when the copy was used; queueSource names where that attempt took its queue from.
            let sessionRestart = options.fromMirror === true ? getSessionRestartCandidate(stored, staleMeta) : null
            let queueSource = 'disk'
            let sessionTail = null
            // The read keys for one attempt: the meta, both manifests, the shard supersets (the queue's only when the copy is not used), and
            // the guessed slot's segments from fromSegment up to segmentCount. The copy's queue shards are not read from disk.
            const buildAtomicReadKeys = (activeCheckpoint, segmentCount, fromSegment, withQueueShards) => {
                const keys = {
                    [COORDINATOR_QUEUE_WAL_META_KEY]: null,
                    [getSegmentedWalCheckpointKey(COORDINATOR_QUEUE_WAL_KEY, CHECKPOINT_A)]: null,
                    [getSegmentedWalCheckpointKey(COORDINATOR_QUEUE_WAL_KEY, CHECKPOINT_B)]: null
                }
                for(const checkpointId of [CHECKPOINT_A, CHECKPOINT_B]) {
                    const shardKeys = withQueueShards
                        ? getAreaShardSupersetKeys(COORDINATOR_QUEUE_WAL_KEY, checkpointId, COORDINATOR_QUEUE_WAL_CHECKPOINT_SHARD_COUNT)
                        : getNonQueueAreaShardSupersetKeys(COORDINATOR_QUEUE_WAL_KEY, checkpointId, COORDINATOR_QUEUE_WAL_CHECKPOINT_SHARD_COUNT)
                    for(const key of shardKeys) keys[key] = null
                }
                for(let segmentNo = fromSegment; segmentNo < segmentCount; segmentNo += 1) {
                    keys[getSegmentedWalSegmentKey(COORDINATOR_QUEUE_WAL_KEY, activeCheckpoint, segmentNo)] = null
                }
                return keys
            }
            for(let attempt = 1; attempt <= COORDINATOR_QUEUE_WAL_HYDRATE_ATTEMPTS; attempt += 1) {
                const guessedActiveCheckpoint = sessionRestart
                    ? sessionRestart.active
                    : (meta.activeCheckpoint === CHECKPOINT_B ? CHECKPOINT_B : CHECKPOINT_A)
                // Where the segment read of the guessed slot starts: 0 for a whole read, the copy's committed count for a session restart.
                let readFrom = sessionRestart ? sessionRestart.committed : 0
                const readMetricPath = attempt > 1
                    ? `${options.metricPath || 'coordinatorQueueWal.segmented.load'}.tornWriteRetry`
                    : options.metricPath || 'coordinatorQueueWal.segmented.load'
                // Deliberately NOT widened by staleMeta's own claimed committed-segment
                // count -- if that count were trusted for sizing too, a queue that
                // legitimately grew past the fixed superset below would have its
                // (accurate) stale meta already reflect that, silently absorbing the
                // undersized case into the "normal" one and leaving the rare fallback
                // path below untested by anything short of an actual race. Keeping
                // this a fixed default means the fallback path is reachable
                // deterministically, from meta alone, whenever real growth outruns it.
                const guessedSegmentCount = Math.min(
                    COORDINATOR_QUEUE_WAL_SEGMENT_HARD_LIMIT,
                    COORDINATOR_QUEUE_WAL_ATOMIC_READ_SEGMENT_SUPERSET
                )
                // This read is the disk re-read of a load: the meta, both checkpoint manifests and their shards, and the committed
                // segments (the fallback read below fetches any segment the first read missed). Object.assign puts these disk values
                // over the mirror copies of the same keys, and a key absent on disk comes back as null, so it replaces the copy too.
                // A restart takes this path, since the resident copy is empty then. So a stale mirror copy (after a lost pending
                // marker and a lost mirror write) cannot reach hydate unchecked, which is why a marker-only freshness check is
                // acceptable at restart. A future path that uses the mirror without this re-read must first compare the disk meta
                // fingerprint with the marker's committed value, and must still check the segment keys as hydrate does.
                // A session restart reads no queue shard, and its segments start at the copy's committed count (architecture.md, section 4.8).
                let atomicReadKeys = buildAtomicReadKeys(guessedActiveCheckpoint, guessedSegmentCount, readFrom, !sessionRestart)
                const atomicRead = await metricStorageGet(atomicReadKeys, {
                    metricPath: readMetricPath,
                    phase: 'queueWalSegmentAtomicStorageGet'
                })
                Object.assign(stored, atomicRead)
                // The session restart decision, on this read. A refusal reads the whole WAL from disk in one more read, with the queue shards,
                // and the attempt goes on as the disk path does (slice 4 rules). Disk always wins when the two disagree.
                let tail = null
                if(sessionRestart) {
                    const decision = decideSessionRestart(stored, sessionRestart)
                    if(decision.ok) tail = decision
                    else {
                        incrementQueueWakeupMetric('coordinatorAuthority.queueWal.restartSessionRefused')
                        sessionRestart = null
                        readFrom = 0
                        atomicReadKeys = buildAtomicReadKeys(guessedActiveCheckpoint, guessedSegmentCount, 0, true)
                        const wholeRead = await metricStorageGet(atomicReadKeys, {
                            metricPath: readMetricPath,
                            phase: 'queueWalSegmentAtomicStorageGet'
                        })
                        Object.assign(stored, wholeRead)
                    }
                }
                queueSource = sessionRestart ? 'session' : 'disk'
                sessionTail = tail
                // Step 4: an arrival checkpoint can name shard ids past the atomic read's range. The manifests in this read name them,
                // so they are read here. The shard identity check then verifies each one against its manifest, as it does any shard.
                // A session restart reads no queue shard, so the queue shards a manifest names that the copy does not hold (the other slot's)
                // are not arrival reads either. The copy's own queue shards are all in stored, so none of them is missing.
                const arrivalShardKeys = [CHECKPOINT_A, CHECKPOINT_B].flatMap(checkpointId =>
                    getArrivalShardKeysMissingFromStored(stored, COORDINATOR_QUEUE_WAL_KEY, checkpointId))
                    .filter(key => !(tail && getCheckpointShardKeyNamespace(key, COORDINATOR_QUEUE_WAL_KEY) === CHECKPOINT_AREA_NAMESPACES.queue))
                // A mirror hydrate takes the queue shards from the session copy, so the completed and runs shards come from disk: the
                // ones in the atomic read's superset, and the arrival shards the copy does not hold. Counted here, as keys requested.
                if(options.fromMirror === true) {
                    const nonQueueKeyCount = countNonQueueShardKeys([...Object.keys(atomicReadKeys), ...arrivalShardKeys], {baseKey: COORDINATOR_QUEUE_WAL_KEY})
                    if(nonQueueKeyCount) incrementQueueWakeupMetric('queueMirror.hydrateCompletedRunsDiskRead', nonQueueKeyCount)
                }
                if(arrivalShardKeys.length) {
                    incrementQueueWakeupMetric('coordinatorAuthority.queueWal.arrivalShardFallbackRead')
                    const arrivalRead = await metricStorageGet(Object.fromEntries(arrivalShardKeys.map(key => [key, null])), {
                        metricPath: options.metricPath
                            ? `${options.metricPath}.arrivalShardRead`
                            : 'coordinatorQueueWal.segmented.load.arrivalShardRead',
                        phase: 'queueWalArrivalShardRead'
                    })
                    Object.assign(stored, arrivalRead)
                }

                const freshMeta = isSegmentedWalStorageMeta(stored[COORDINATOR_QUEUE_WAL_META_KEY])
                    ? stored[COORDINATOR_QUEUE_WAL_META_KEY]
                    : null
                if(freshMeta) {
                    const freshActiveCheckpoint = freshMeta.activeCheckpoint === CHECKPOINT_B ? CHECKPOINT_B : CHECKPOINT_A
                    const freshCommittedSegments = getSegmentedWalCommittedSegmentCount(freshMeta, freshActiveCheckpoint)
                    // The guessed slot's segments the reads above fetched run from readFrom up to guessedSegmentCount. The fallback starts where
                    // that run ends, or at 0 when the slot moved (every segment of the fresh slot is then read).
                    const alreadyFetchedSegmentCount = freshActiveCheckpoint === guessedActiveCheckpoint
                        ? Math.max(readFrom, guessedSegmentCount)
                        : 0
                    if(freshCommittedSegments > alreadyFetchedSegmentCount) {
                        // Rare: either the superset undersized the real segment
                        // count, or the active checkpoint flipped between our guess
                        // and this same read's own fresh meta (a switch landed
                        // concurrently). One more read, sized EXACTLY from the meta
                        // this function just fetched a moment ago -- not the
                        // caller's stale one -- so the residual race window is
                        // between two awaits inside this one function call, not
                        // across the caller's separate, earlier fetch.
                        incrementQueueWakeupMetric('coordinatorAuthority.queueWal.atomicReadUndersized')
                        const fallbackReadKeys = {}
                        for(let segmentNo = alreadyFetchedSegmentCount; segmentNo < freshCommittedSegments; segmentNo += 1) {
                            fallbackReadKeys[getSegmentedWalSegmentKey(COORDINATOR_QUEUE_WAL_KEY, freshActiveCheckpoint, segmentNo)] = null
                        }
                        const fallbackRead = await metricStorageGet(fallbackReadKeys, {
                            metricPath: options.metricPath
                                ? `${options.metricPath}.atomicReadFallback`
                                : 'coordinatorQueueWal.segmented.load.atomicReadFallback',
                            phase: 'queueWalSegmentAtomicReadFallback'
                        })
                        Object.assign(stored, fallbackRead)
                    }
                }
                // What this read found in storage, recorded for the checkpoint switch (see rememberedSlots above).
                if(freshMeta) rememberCheckpointSlotsFromRead(stored, freshMeta)
                meta = freshMeta || staleMeta

                hydrated = runQueueWakeupMetricPhase('queueWalHydrate', () => hydrateSegmentedWalStore(stored, {
                    baseKey: COORDINATOR_QUEUE_WAL_KEY,
                    fallbackStore: stored[COORDINATOR_QUEUE_WAL_KEY] || null
                }))
                if(hydrated?.ok === true && hydrated.store) break
                if(attempt < COORDINATOR_QUEUE_WAL_HYDRATE_ATTEMPTS) {
                    incrementQueueWakeupMetric('coordinatorAuthority.queueWal.segmentedHydrateTornWriteRetried')
                }
            }
            // The queue shard fallback (owner decision, 27 Oct; architecture.md, section 4.8). Cheap detection only: the disk read named a
            // missing key, or a record that fails its identity, and hydrate already saw that. No shard is decoded here. The fallback runs
            // for a QUEUE shard of the active slot from disk only; a completed or runs shard falls through and fails closed below.
            if(queueSource === 'disk' && (hydrated?.reason === 'missing-checkpoint-shard' || hydrated?.reason === 'checkpoint-shard-identity-mismatch') &&
                getCheckpointShardKeyNamespace(hydrated.missingKey, COORDINATOR_QUEUE_WAL_KEY) === CHECKPOINT_AREA_NAMESPACES.queue) {
                const repair = await recoverQueueShardFromSession(stored, meta, hydrated.missingKey)
                if(repair) {
                    Object.assign(stored, repair.copy)
                    hydrated = repair.hydrated
                }
            }
            // The checkpoint binding (docs/queue-storage-layering.md, section 6). Disk first: a manifest that still disagrees with the disk
            // meta after the single re-read is torn, and only then is the session mirror's copy considered (recoverCheckpointFromMirror,
            // Recovery A). An intact disk checkpoint never reaches that path. Otherwise the load fails closed, below, and the mismatch is
            // recorded with both fingerprints.
            let checkpointMismatch = null
            let recoveredFromMirror = null
            if(hydrated?.reason === CHECKPOINT_MANIFEST_META_MISMATCH) {
                incrementQueueWakeupMetric('coordinatorAuthority.queueWal.checkpointMismatch')
                const recovery = await recoverCheckpointFromMirror(stored, meta)
                checkpointMismatch = recovery.mismatch
                if(recovery.hydrated) {
                    Object.assign(stored, recovery.copy)
                    hydrated = recovery.hydrated
                    recoveredFromMirror = recovery.mismatch
                }
            }
            if(hydrated?.ok === true && hydrated.store) {
                incrementQueueWakeupMetric('coordinatorAuthority.queueWal.segmentedHydrated')
                // The restart report of the hydrate caller (sw.js loadCoordinatorCurrentAuthorityState), set only for an accepted store.
                // tailIds holds the ids of the disk tail records the copy does not hold, so the caller can count the ones recovery applied.
                if(options.restartReport) {
                    const report = options.restartReport
                    report.queueSource = queueSource
                    report.tailIds = null
                    report.tailRecordCount = 0
                    if(sessionTail) {
                        const tailActive = normalizeCheckpointId(hydrated.store.meta?.activeCheckpoint)
                        const recordsOf = segmentNo => stored[getSegmentedWalSegmentKey(COORDINATOR_QUEUE_WAL_KEY, tailActive, segmentNo)]?.segment?.records || []
                        // The ids the copy's own segments hold. A tail record with one of these ids is a repeat, and recovery applies the first
                        // of them only, so it is not counted as a tail record applied.
                        const copyIds = new Set()
                        for(let segmentNo = 0; segmentNo < sessionTail.tailFrom; segmentNo += 1) {
                            for(const record of recordsOf(segmentNo)) copyIds.add(`${record?.id ?? ''}`.trim())
                        }
                        const tailIds = new Set()
                        let tailRecordCount = 0
                        for(let segmentNo = sessionTail.tailFrom; segmentNo < sessionTail.tailTo; segmentNo += 1) {
                            for(const record of recordsOf(segmentNo)) {
                                tailRecordCount += 1
                                const id = `${record?.id ?? ''}`.trim()
                                if(!copyIds.has(id)) tailIds.add(id)
                            }
                        }
                        report.tailIds = tailIds
                        report.tailRecordCount = tailRecordCount
                    }
                }
                if(recoveredFromMirror) {
                    // Recorded here, once the store is accepted. The copy has passed every check the loader applies to it (identity,
                    // hydrate and the state hash), and a copy refused at any of them is never reported as recovered.
                    const facts = recoveredFromMirror
                    incrementQueueWakeupMetric('coordinatorAuthority.queueWal.checkpointRecoveredFromMirror')
                    incrementQueueWakeupMetric('coordinatorAuthority.queueWal.checkpointMirrorCopyUsedDiskTorn')
                    recordCoordinatorDiagnosticEvent(
                        CHECKPOINT_RECOVERED_EVENT,
                        `Active checkpoint ${facts.checkpointId} recovered from the session mirror: the disk manifest (fingerprint ${facts.manifestFingerprint}) disagreed with the metadata (fingerprint ${facts.metaFingerprint}); the mirror copy (fingerprint ${facts.copyFingerprint}) agrees with the metadata and was used.`,
                        {...facts}
                    )
                    recordFlightRecorderEvent({
                        kind: CHECKPOINT_RECOVERED_FLIGHT_KIND,
                        source: 'loadStoreFromStorage',
                        checkpointId: facts.checkpointId,
                        metaFingerprint: facts.metaFingerprint,
                        manifestFingerprint: facts.manifestFingerprint,
                        copyFingerprint: facts.copyFingerprint
                    })
                }
                const activeSegmentCount = getSegmentedWalCommittedSegmentCount(
                    meta,
                    hydrated.store?.meta?.activeCheckpoint || ''
                )
                recordQueueWakeupMetricMax('coordinatorAuthority.queueWal.maxActivePhysicalSegments', activeSegmentCount)
                if(options.suppressCheckpointSwitchSchedule !== true &&
                    activeSegmentCount >= COORDINATOR_QUEUE_WAL_SEGMENT_SOFT_SWITCH_AT) {
                    incrementQueueWakeupMetric('coordinatorAuthority.queueWal.segmentSoftSwitchScheduledFromRead')
                    scheduleCoordinatorQueueWalCheckpointSwitch('segmentSoftRead', activeSegmentCount)
                }
                void maybeCheckCoordinatorStorageQuotaHealth('queueWal-hydrate')
                stored[COORDINATOR_QUEUE_WAL_KEY] = hydrated.store
                resident.set(hydrated.store)
                return hydrated.store
            }
            incrementQueueWakeupMetric('coordinatorAuthority.queueWal.segmentedHydrateFailed')
            recordCoordinatorDiagnosticEvent(
                'coordinator-authority-queue-wal-segmented-hydrate-failed',
                hydrated?.reason || 'Coordinator authority queue WAL segmented hydrate failed'
            )
            if(checkpointMismatch) {
                // Fail closed, and say which checkpoint disagrees and how. The throw below keeps the authority unavailable.
                const facts = checkpointMismatch
                recordCoordinatorDiagnosticEvent(
                    CHECKPOINT_MISMATCH_EVENT,
                    `Active checkpoint ${facts.checkpointId}: the metadata fingerprint ${facts.metaFingerprint} does not match the disk manifest fingerprint ${facts.manifestFingerprint}; session mirror copy: ${facts.mirror}. Failing closed: the queue authority is unavailable.`,
                    {...facts}
                )
                recordFlightRecorderEvent({
                    kind: CHECKPOINT_MISMATCH_FLIGHT_KIND,
                    source: 'loadStoreFromStorage',
                    checkpointId: facts.checkpointId,
                    metaFingerprint: facts.metaFingerprint,
                    manifestFingerprint: facts.manifestFingerprint,
                    mirror: facts.mirror
                })
            }
            // 2026-09-15: auto-recover instead of leaving the coordinator dead in
            // the water -- this used to require someone running a CDP helper by
            // hand after every "missing-segment" incident (both the helper and the
            // view recovery have since been retired, see historical/LEGACY_QUEUE_VIEW_RETIREMENT.md) (a hard crash mid checkpoint-switch is
            // enough to cause one; chrome.storage.local has no cross-key
            // transaction guarantee). mbCoordinatorQueueView is a materialized
            // read-model independent of the WAL's own physical segments, so it
            // survives exactly the corruption that breaks hydrate. Same safety
            // gate as the manual tool: refuse to apply if the rebuilt row count
            // doesn't match the view's own item count.
            //
            // This MUST run before the 'missing-checkpoint' branch below, not
            // after -- the first version of this fix put it after, so a
            // *different* hydrate failure reason ('missing-checkpoint', hit by a
            // routine SW restart racing the auto-recovery's own durable persist)
            // fell into that older branch and reset straight to an empty
            // checkpoint without ever looking at the view, wiping a
            // just-recovered queue within seconds of recovering it (2026-09-15
            // incident: 900 rows -> 0, caught only because the other checkpoint
            // slot happened to survive untouched).
            // 2026-09-16: under severe write-queue backlog (the settle-terminal
            // bottleneck found live this morning, ~30s-265s stalls), this
            // function's own storage read can itself hit the serialized-update
            // queue's timeout-recovery/abandon mechanism and throw ("abandoned
            // storage update suppressed...") instead of returning a normal
            // {ok:false} result. Uncaught, that exception used to propagate raw
            // out of loadCoordinatorQueueWalStoreFromStorage, skipping every
            // counter below (segmentedAutoRecoveredFromView,
            // segmentedAutoRecoveryFromViewFailed, segmentedMissingCheckpointReset
            // all stayed at 0 even while segmentedHydrateFailed climbed into the
            // dozens) and handing whatever called hydrate an unexpected timeout
            // error instead of the documented hydrate-failure contract. Treating
            // a thrown recovery attempt the same as an unsuccessful one keeps the
            // contract intact -- and correctly counted -- no matter how backed up
            // storage is.
            // Retired: a hydrate failure is never rebuilt from the legacy queue view. That copy predates the
            // WAL and can resurrect rows the WAL has already moved past. The failure below is the contract.
            incrementQueueWakeupMetric('coordinatorAuthority.queueWal.segmentedRecoveryRetired')
            // P4: a WAL that cannot be decoded is not an empty WAL. The missing-checkpoint reset that used to return a fresh
            // empty checkpoint here is gone: the failure is tagged, and the authority becomes unavailable (hydrate).
            const decodeError = new Error(`segmented queue WAL hydrate failed: ${hydrated?.reason || 'hydrate-failed'}`)
            decodeError.walDecodeFailed = true
            throw decodeError
        }

        // The monolith read also asks for the manifests of both slots, in the same await (no extra tick). With no segmented meta they are the
        // only disk record of the checkpoint, and the guard below reads them from this read.
        let monolithDiskRead = null
        if(!Object.prototype.hasOwnProperty.call(stored || {}, COORDINATOR_QUEUE_WAL_KEY)) {
            monolithDiskRead = await metricStorageGet({
                [COORDINATOR_QUEUE_WAL_KEY]: null,
                [getSegmentedWalCheckpointKey(COORDINATOR_QUEUE_WAL_KEY, CHECKPOINT_A)]: null,
                [getSegmentedWalCheckpointKey(COORDINATOR_QUEUE_WAL_KEY, CHECKPOINT_B)]: null
            }, {
                metricPath: options.metricPath
                    ? `${options.metricPath}.monolithFallback`
                    : 'coordinatorQueueWal.monolithFallback.load'
            })
            stored[COORDINATOR_QUEUE_WAL_KEY] = monolithDiskRead?.[COORDINATOR_QUEUE_WAL_KEY] || null
        }

        const storedWal = stored[COORDINATOR_QUEUE_WAL_KEY]
        const fallback = normalizeCoordinatorQueueWalStore(storedWal, snapshotQueue)
        // normalizeCoordinatorQueueWalStore returns the store it was given when it is valid, and a new queue-only checkpoint when it is not. The
        // queue-only checkpoint is refused when the disk names a completed or runs shard, because it would orphan them. The refusal is the same
        // decode error the unreadable store raises above (walDecodeFailed), so hydrate fails closed.
        if(fallback !== storedWal) {
            const disk = {...stored, ...(monolithDiskRead || {})}
            if(storedNamesNonQueueCheckpointShards(disk, COORDINATOR_QUEUE_WAL_KEY)) {
                incrementQueueWakeupMetric('coordinatorAuthority.queueWal.queueOnlyCheckpointRefused')
                const decodeError = new Error('segmented queue WAL hydrate failed: queue-only-checkpoint-refused')
                decodeError.walDecodeFailed = true
                throw decodeError
            }
        }
        stored[COORDINATOR_QUEUE_WAL_KEY] = fallback
        return fallback
    }

    return {
        resident,
        cacheFromWrite,
        loadStoreFromStorage,
        prepareCheckpointWrite,
        noteCheckpointSaved,
        noteCheckpointSaveFailed,
        noteStorageRemovals,
        forgetCheckpointSlots
    }
}

module.exports = {
    createQueueWalStore,
    MIRROR_REBUILD_SKIPPED_EVENT,
    MIRROR_REBUILD_SKIPPED_FLIGHT_KIND
}
