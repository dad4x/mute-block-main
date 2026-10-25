const assert = require('node:assert/strict')
const zlib = require('node:zlib')
const wal = require('../shared/js/walSnapshotStore')

function test(name, fn) {
    return Promise.resolve().then(fn).then(() => console.log(`ok - ${name}`), error => {
        console.error(`not ok - ${name}`)
        throw error
    })
}

const codec = {
    name: 'gzip',
    compress: bytes => zlib.gzipSync(bytes),
    decompress: bytes => zlib.gunzipSync(bytes)
}

const PER_SHARD = 4

// The instance's policy: an entry's shard is the arrival chunk it was stored in. The store keeps that id on the entry.
const shardOf = (area, key, entry) => entry.shard

function makeEntries(count, startSeq = 0) {
    const entries = {}
    for (let seq = startSeq; seq < startSeq + count; seq += 1) {
        const key = `https://www.quora.com/profile/Arrival-${seq}`
        entries[key] = {seq, shard: Math.floor(seq / PER_SHARD), status: 'succeeded', terminalAt: 1000 + seq}
    }
    return entries
}

function makeCheckpoint(entries, {id = 'A', seq = 1} = {}) {
    return wal.makeCheckpoint({rows: entries, note: 'arrival'}, {
        id,
        snapshotSeq: seq,
        snapshotEpoch: 1,
        createdAt: 1000,
        codec,
        codecName: codec.name,
        shardOf
    })
}

async function main() {
    await test('an arrival-ordered checkpoint stores each entry in the shard its policy names, and decodes to the same state', async () => {
        const entries = makeEntries(10)
        const checkpoint = makeCheckpoint(entries)
        assert.deepEqual(checkpoint.shards.map(shard => shard.index), [0, 1, 2])
        assert.equal(checkpoint.shardCount, 3)
        const manifest = wal.getCheckpointManifest(checkpoint)
        assert.equal(manifest.shardIds, undefined, 'ids 0 to n-1 are the default, so the manifest omits them')
        assert.deepEqual(wal.getCheckpointShardIds(manifest), [0, 1, 2])
        const decoded = wal.decodeCheckpointSnapshot(checkpoint, {codec})
        assert.equal(decoded.ok, true, decoded.reason)
        assert.deepEqual(decoded.state.rows, entries)
        assert.equal(decoded.state.note, 'arrival', 'a value area is kept whole')
    })

    await test('a new arrival changes only the newest shard, so the older shards keep their content hashes', async () => {
        const before = makeCheckpoint(makeEntries(10), {id: 'A', seq: 1})
        const after = makeCheckpoint(makeEntries(11), {id: 'B', seq: 2})
        const hashesBefore = Object.fromEntries(before.shards.map(shard => [shard.index, shard.shardStateHash]))
        const hashesAfter = Object.fromEntries(after.shards.map(shard => [shard.index, shard.shardStateHash]))
        assert.equal(hashesAfter[0], hashesBefore[0], 'the oldest shard is unchanged')
        assert.equal(hashesAfter[1], hashesBefore[1], 'the middle shard is unchanged')
        assert.notEqual(hashesAfter[2], hashesBefore[2], 'only the newest shard changed')
    })

    await test('dropping an expired shard leaves the others in place, with their ids', async () => {
        const entries = makeEntries(12)
        const kept = Object.fromEntries(Object.entries(entries).filter(([, entry]) => entry.shard >= 1))
        const dropped = makeCheckpoint(kept, {id: 'B', seq: 2})
        assert.deepEqual(dropped.shards.map(shard => shard.index), [1, 2])
        assert.deepEqual(wal.getCheckpointManifest(dropped).shardIds, [1, 2])
        const decoded = wal.decodeCheckpointSnapshot(dropped, {codec})
        assert.equal(decoded.ok, true, decoded.reason)
        assert.deepEqual(decoded.state.rows, kept)
    })

    await test('a state with no map entries still gets one shard, so the checkpoint is sharded', async () => {
        const checkpoint = wal.makeCheckpoint({rows: {}, note: 'empty'}, {id: 'A', snapshotSeq: 1, codec, codecName: codec.name, shardOf})
        assert.equal(checkpoint.format, wal.CHECKPOINT_SHARD_FORMAT)
        assert.deepEqual(checkpoint.shards.map(shard => shard.index), [0])
        const decoded = wal.decodeCheckpointSnapshot(checkpoint, {codec})
        assert.equal(decoded.ok, true, decoded.reason)
        assert.equal(decoded.state.note, 'empty')
    })

    await test('a policy that returns a negative or non-numeric shard id is refused', async () => {
        assert.throws(() => wal.makeCheckpoint({rows: {'k': {}}}, {id: 'A', snapshotSeq: 1, codec, codecName: codec.name, shardOf: () => -1}), /shardOf returned/)
        assert.throws(() => wal.makeCheckpoint({rows: {'k': {}}}, {id: 'A', snapshotSeq: 1, codec, codecName: codec.name, shardOf: () => 'x'}), /shardOf returned/)
    })

    await test('an arrival-ordered slot refuses a keyed read from storage and from the resident copy, and its read keys take every shard', async () => {
        const BASE = 'mbArrival'
        const entries = makeEntries(10)
        const store = wal.makePairedCheckpointStore({}, {snapshotSeq: 0, codec})
        const written = wal.writeInactiveCheckpoint(store, {rows: entries, note: 'arrival'}, {
            snapshotSeq: 1, snapshotEpoch: 1, createdAt: 1000, codec, codecName: codec.name, shardOf
        })
        const activated = wal.activateCheckpoint(written.store, written.checkpointId, {codec})
        assert.equal(activated.activated, true, activated.reason)
        const active = activated.store
        const payload = wal.buildSegmentedWalStoragePayload(active, {baseKey: BASE, writeCheckpoints: true, generationsToWrite: [written.checkpointId]})
        const metaKey = wal.getSegmentedWalMetaKey(BASE)
        const key = 'https://www.quora.com/profile/Arrival-3'

        const fromStorage = wal.projectKeyedRowFromStored(payload, {baseKey: BASE, area: 'rows', key, codec})
        assert.equal(fromStorage.ok, false)
        assert.equal(fromStorage.reason, wal.ARRIVAL_KEYED_READ_REFUSED)

        // The resident copy carries the disk meta it was written with, as the keyed-read test's residentOf does.
        const resident = {...active, meta: payload[metaKey]}
        const fromResident = wal.projectKeyedRowFromResidentStore(resident, payload[metaKey], {area: 'rows', key, codec})
        assert.equal(fromResident.ok, false)
        assert.equal(fromResident.reason, wal.ARRIVAL_KEYED_READ_REFUSED)

        const readKeys = wal.getKeyedRowReadKeys(payload[metaKey], key, {baseKey: BASE})
        for (let index = 0; index < 3; index += 1) {
            assert.ok(readKeys.includes(wal.getSegmentedWalCheckpointShardKey(BASE, written.checkpointId, index)), `shard ${index} is a read key`)
        }
        assert.equal(wal.getCheckpointPartition(active.checkpoints[written.checkpointId]), wal.CHECKPOINT_PARTITION_ARRIVAL)
    })

    console.log('arrival shards: all tests ran')
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
