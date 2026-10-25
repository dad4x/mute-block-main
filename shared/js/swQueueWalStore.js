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
    getSegmentedWalCheckpointShardKeys,
    getSegmentedWalSegmentKey,
    getSegmentedWalCommittedSegmentCount,
    isSegmentedWalStorageMeta,
    normalizeCheckpointId,
    normalizeCheckpointShardCount,
    hydrateSegmentedWalStore,
    verifyCheckpoint,
    writeInactiveCheckpoint,
    CHECKPOINT_SHARD_FORMAT,
    getSegmentedWalCheckpointShardKey,
    getSegmentedWalMetaKey
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

    // Recovery A of the checkpoint binding (docs/queue-storage-layering.md, section 6). The session mirror holds the worker's own
    // copy of the active checkpoint: its manifest and shard records, written with the mirror. The copy is a candidate, and it is
    // never trusted by itself. It is used only when checkpointManifestMatchesMeta holds for it against the disk meta, which is the
    // check the disk manifest failed. Then hydrate runs on a store built from it, and that checks each shard's identity against the
    // copy's manifest. A copy that fails either check is not used. Returns hydrated (ok only when the copy was used), copy (the keys
    // to put into stored, when it was used), and mismatch (the facts the diagnostics record, and what happened to the copy).
    async function recoverCheckpointFromMirror(stored, meta) {
        const active = normalizeCheckpointId(meta.activeCheckpoint)
        const metaCheckpoint = meta.checkpoints?.[active] || null
        const manifestKey = getSegmentedWalCheckpointKey(COORDINATOR_QUEUE_WAL_KEY, active)
        const shardKeys = getSegmentedWalCheckpointShardKeys(
            COORDINATOR_QUEUE_WAL_KEY,
            active,
            normalizeCheckpointShardCount(metaCheckpoint?.shardCount)
        )
        const diskManifest = stored?.[manifestKey] || {}
        const mismatch = {
            checkpointId: active,
            metaFingerprint: getCheckpointFingerprint(metaCheckpoint || {}, active),
            manifestFingerprint: getCheckpointFingerprint(diskManifest, normalizeCheckpointId(diskManifest.id)),
            mirror: 'none',
            copyFingerprint: ''
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

        const copyKeys = Object.fromEntries(keys.map(key => [key, copy[key] ?? null]))
        const hydrated = runQueueWakeupMetricPhase('queueWalHydrate', () => hydrateSegmentedWalStore({...stored, ...copyKeys}, {
            baseKey: COORDINATOR_QUEUE_WAL_KEY,
            fallbackStore: stored[COORDINATOR_QUEUE_WAL_KEY] || null
        }))
        if(hydrated?.ok !== true || !hydrated.store) {
            incrementQueueWakeupMetric('coordinatorAuthority.queueWal.checkpointMirrorCopyRejected')
            mismatch.mirror = `unusable (${hydrated?.reason || 'hydrate-failed'}, fingerprint ${copyFingerprint})`
            return {hydrated: null, copy: null, mismatch}
        }
        // The state hash check (hole 2). The copy's shards must decode and each match its own hash, and the merged state must hash to
        // the manifest's stateHash. This is the check recovery applies to the store later (recoverProjectedState), so a copy that fails
        // it is refused here, and the recovery is recorded only for a copy that passes.
        const verification = verifyCheckpoint(hydrated.store.checkpoints?.[active], COORDINATOR_QUEUE_WAL_SNAPSHOT_CODEC_OPTIONS)
        if(!verification.ok) {
            incrementQueueWakeupMetric('coordinatorAuthority.queueWal.checkpointMirrorCopyRejected')
            mismatch.mirror = `unusable (${verification.reason}, fingerprint ${copyFingerprint})`
            return {hydrated: null, copy: null, mismatch}
        }
        mismatch.mirror = 'used'
        mismatch.copyFingerprint = copyFingerprint
        return {hydrated, copy: copyKeys, mismatch}
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
            for(let attempt = 1; attempt <= COORDINATOR_QUEUE_WAL_HYDRATE_ATTEMPTS; attempt += 1) {
                const guessedActiveCheckpoint = meta.activeCheckpoint === CHECKPOINT_B ? CHECKPOINT_B : CHECKPOINT_A
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
                const atomicReadKeys = {
                    [COORDINATOR_QUEUE_WAL_META_KEY]: null,
                    [getSegmentedWalCheckpointKey(COORDINATOR_QUEUE_WAL_KEY, CHECKPOINT_A)]: null,
                    [getSegmentedWalCheckpointKey(COORDINATOR_QUEUE_WAL_KEY, CHECKPOINT_B)]: null
                }
                for(const checkpointId of [CHECKPOINT_A, CHECKPOINT_B]) {
                    for(const key of getSegmentedWalCheckpointShardKeys(COORDINATOR_QUEUE_WAL_KEY, checkpointId, COORDINATOR_QUEUE_WAL_CHECKPOINT_SHARD_COUNT)) {
                        atomicReadKeys[key] = null
                    }
                }
                for(let segmentNo = 0; segmentNo < guessedSegmentCount; segmentNo += 1) {
                    atomicReadKeys[getSegmentedWalSegmentKey(COORDINATOR_QUEUE_WAL_KEY, guessedActiveCheckpoint, segmentNo)] = null
                }
                // This read is the disk re-read of a load: the meta, both checkpoint manifests and their shards, and the committed
                // segments (the fallback read below fetches any segment the first read missed). Object.assign puts these disk values
                // over the mirror copies of the same keys, and a key absent on disk comes back as null, so it replaces the copy too.
                // A restart takes this path, since the resident copy is empty then. So a stale mirror copy (after a lost pending
                // marker and a lost mirror write) cannot reach hydrate unchecked, which is why a marker-only freshness check is
                // acceptable at restart. A future path that uses the mirror without this re-read must first compare the disk meta
                // fingerprint with the marker's committed value, and must still check the segment keys as hydrate does.
                const atomicRead = await metricStorageGet(atomicReadKeys, {
                    metricPath: attempt > 1
                        ? `${options.metricPath || 'coordinatorQueueWal.segmented.load'}.tornWriteRetry`
                        : options.metricPath || 'coordinatorQueueWal.segmented.load',
                    phase: 'queueWalSegmentAtomicStorageGet'
                })
                Object.assign(stored, atomicRead)

                const freshMeta = isSegmentedWalStorageMeta(stored[COORDINATOR_QUEUE_WAL_META_KEY])
                    ? stored[COORDINATOR_QUEUE_WAL_META_KEY]
                    : null
                if(freshMeta) {
                    const freshActiveCheckpoint = freshMeta.activeCheckpoint === CHECKPOINT_B ? CHECKPOINT_B : CHECKPOINT_A
                    const freshCommittedSegments = getSegmentedWalCommittedSegmentCount(freshMeta, freshActiveCheckpoint)
                    const alreadyFetchedSegmentCount = freshActiveCheckpoint === guessedActiveCheckpoint ? guessedSegmentCount : 0
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
            // The checkpoint binding (docs/queue-storage-layering.md, section 6). A manifest that still disagrees with the disk meta
            // after the single re-read is recovered from the session mirror's copy when that copy agrees with the meta. Otherwise the
            // load fails closed, below, and the mismatch is recorded with both fingerprints.
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
                if(recoveredFromMirror) {
                    // Recorded here, once the store is accepted. The copy has passed every check the loader applies to it (identity,
                    // hydrate and the state hash), and a copy refused at any of them is never reported as recovered.
                    const facts = recoveredFromMirror
                    incrementQueueWakeupMetric('coordinatorAuthority.queueWal.checkpointRecoveredFromMirror')
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

        if(!Object.prototype.hasOwnProperty.call(stored || {}, COORDINATOR_QUEUE_WAL_KEY)) {
            const monolithFallbackStored = await metricStorageGet({[COORDINATOR_QUEUE_WAL_KEY]: null}, {
                metricPath: options.metricPath
                    ? `${options.metricPath}.monolithFallback`
                    : 'coordinatorQueueWal.monolithFallback.load'
            })
            stored[COORDINATOR_QUEUE_WAL_KEY] = monolithFallbackStored?.[COORDINATOR_QUEUE_WAL_KEY] || null
        }

        const fallback = normalizeCoordinatorQueueWalStore(stored[COORDINATOR_QUEUE_WAL_KEY], snapshotQueue)
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
