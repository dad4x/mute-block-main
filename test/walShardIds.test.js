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

// Shard ids that are not 0 to n-1, the way a store will name its shards once its partition is not positional (step 1a).
const SHARD_IDS = [2, 5, 9]
const STATE = {
    queue: {'https://www.quora.com/profile/Shard-Id-A': {status: 'queued'}, 'https://www.quora.com/profile/Shard-Id-B': {status: 'active'}},
    runs: {'run-shard-ids': {id: 'run-shard-ids', queued: 1}},
    progress: {}
}

function makeCheckpoint(shardIds) {
    return wal.makeCheckpoint(STATE, {
        id: 'A',
        snapshotSeq: 7,
        snapshotEpoch: 1,
        createdAt: 1000,
        codec,
        codecName: codec.name,
        shardCount: 3,
        ...(shardIds ? {shardIds} : {})
    })
}

async function main() {
    await test('a checkpoint with the hash partition stores no shard ids, so its manifest is unchanged', async () => {
        const checkpoint = makeCheckpoint(null)
        assert.equal(Object.prototype.hasOwnProperty.call(wal.getCheckpointManifest(checkpoint), 'shardIds'), false)
        assert.deepEqual(wal.getCheckpointShardIds(checkpoint), [0, 1, 2])
    })

    await test('a checkpoint with explicit shard ids stores them in its manifest and reads them back', async () => {
        const checkpoint = makeCheckpoint(SHARD_IDS)
        const manifest = wal.getCheckpointManifest(checkpoint)
        assert.deepEqual(manifest.shardIds, SHARD_IDS)
        assert.deepEqual(wal.getCheckpointShardIds(manifest), SHARD_IDS)
        assert.deepEqual(manifest.shards.map(shard => shard.index), SHARD_IDS)
    })

    await test('a checkpoint with explicit shard ids decodes to the state it was made from', async () => {
        const checkpoint = makeCheckpoint(SHARD_IDS)
        const decoded = wal.decodeCheckpointSnapshot(checkpoint, {codec})
        assert.equal(decoded.ok, true, decoded.reason)
        assert.deepEqual(decoded.state, STATE)
    })

    await test('a stored checkpoint reads each shard by its id, and rejects a shard whose id does not match', async () => {
        const checkpoint = makeCheckpoint(SHARD_IDS)
        const stored = {}
        stored[wal.getSegmentedWalCheckpointKey('wal', 'A')] = wal.getCheckpointManifest(checkpoint)
        for (const shard of checkpoint.shards) {
            stored[wal.getSegmentedWalCheckpointShardKey('wal', 'A', shard.index)] = wal.getCheckpointShardRecord(checkpoint, shard)
        }
        const read = wal.readStoredCheckpoint(stored, 'wal', 'A')
        assert.equal(read.ok, true, read.reason)
        assert.deepEqual(read.checkpoint.shards.map(shard => shard.index), SHARD_IDS)

        const wrongId = {...stored}
        wrongId[wal.getSegmentedWalCheckpointShardKey('wal', 'A', 5)] = wal.getCheckpointShardRecord(checkpoint, {...checkpoint.shards[0], index: 5, shardStateHash: 'not-the-hash'})
        assert.equal(wal.readStoredCheckpoint(wrongId, 'wal', 'A').ok, false, 'a shard whose hash does not match its manifest is refused')
    })

    console.log('shard ids: all tests ran')
}

main().catch(() => {
    process.exitCode = 1
})
