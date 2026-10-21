#!/usr/bin/env node

'use strict'

const os = require('os')
const { spawn, spawnSync } = require('child_process')

const DEFAULT_COMMAND_TIMEOUT_MS = 30000
const KILL_GRACE_MS = 5000
const DEFAULT_SYNTHETIC_SHARDS = 48

const lanes = [
  {
    name: 'unit',
    commandTimeoutMs: 30000,
    commands: [
      ['node', 'test/subject.test.js'],
      ['node', 'test/jobState.test.js'],
      ['node', 'test/swQueueRuntime.test.js'],
      ['node', 'test/storageInvariants.test.js'],
      ['node', 'test/rawReportPages.test.js'],
      ['node', 'test/sharedModeration.test.js'],
      ['node', 'test/contentActionSelectors.test.js'],
      ['node', 'test/contentUnmuteVerification.test.js'],
      ['node', 'test/contentSpaceScopedState.test.js'],
      ['node', 'test/contentSourcePostResolution.test.js'],
      ['node', 'test/contentEnqueueChunkRetry.test.js'],
      ['node', 'test/contentInlineResolution.test.js'],
      ['node', 'test/contentQueuedClaimHold.test.js'],
      ['node', 'test/acceptedReviewChanges.test.js'],
      ['node', 'test/cdpClickProfileExtensionAction.test.js'],
      ['node', 'test/requeueFailures.test.js'],
      ['node', 'test/swStorageMetrics.test.js'],
      ['node', 'test/swQueueWal.test.js'],
      ['node', 'test/swQueueWalRecovery.test.js'],
      ['node', 'test/swQueueWalStore.test.js'],
      ['node', 'test/swQueueWalDurableReads.test.js']
    ]
  },
  {
    name: 'wal',
    commandTimeoutMs: 60000,
    commands: [
      ['node', 'test/walSnapshotStore.test.js'],
      ['node', 'test/walCheckpointShards.test.js'],
      ['node', 'test/walKeyedRead.test.js'],
      ['node', 'test/walIncrementalVerify.test.js'],
      ['node', 'test/walSnapshotStoreFuzz.test.js']
    ]
  },
  {
    name: 'contract',
    commandTimeoutMs: 30000,
    commands: [
      ['node', 'test/p1-contract.test.js'],
      ['node', 'test/colorTokens.test.js'],
      ['node', 'test/terminalOwnedTabScope.test.js'],
      ['node', 'test/swStorageLane.test.js'],
      ['node', 'test/swQueueBarSummary.test.js'],
      ['node', 'test/candidateListEvidence.test.js'],
      ['node', 'test/swResumeExemption.test.js'],
      ['node', 'test/swProfileNukeProgressPush.test.js'],
      ['node', 'test/spaceMapStorage.test.js'],
      ['node', 'test/spaceMapBuckets.test.js'],
      ['node', 'test/coordinatorEventRecord.test.js']
    ]
  },
  {
    name: 'synthetic',
    commandTimeoutMs: 1200000,
    commands: []
  },
  {
    name: 'scenario',
    commandTimeoutMs: 300000,
    commands: [
      ['node', 'test/sharedModerationFuzz.test.js'],
      ['node', 'test/swScenarioFuzz.test.js']
    ]
  },
  {
    name: 'lint',
    commandTimeoutMs: 30000,
    commands: [
      ['node', 'tools/lint-correctness.js']
    ]
  }
]

function getSyntheticShardCount() {
  const raw = `${process.env.SW_SYNTHETIC_SHARDS || ''}`.trim()
  if (!raw) {
    return DEFAULT_SYNTHETIC_SHARDS
  }
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 1) {
    console.warn(`Ignoring invalid SW_SYNTHETIC_SHARDS=${JSON.stringify(raw)}; using ${DEFAULT_SYNTHETIC_SHARDS}`)
    return DEFAULT_SYNTHETIC_SHARDS
  }
  return parsed
}

function getSyntheticTestInventory() {
  const result = spawnSync(process.execPath, ['test/swSynthetic.test.js', '--list'], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8'
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    const stderr = result.stderr ? `\n${result.stderr}` : ''
    const stdout = result.stdout ? `\n${result.stdout}` : ''
    throw new Error(`Unable to list swSynthetic tests; exit=${result.status}${stderr}${stdout}`)
  }
  const inventory = result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => {
      const match = line.match(/^(\d+)\t(.+)$/)
      if (!match) {
        throw new Error(`Unexpected swSynthetic --list line: ${JSON.stringify(line)}`)
      }
      return {
        index: Number.parseInt(match[1], 10),
        name: match[2]
      }
    })
  if (inventory.length === 0) {
    throw new Error('swSynthetic --list returned no tests')
  }
  const lastIndex = inventory[inventory.length - 1].index
  if (lastIndex !== inventory.length) {
    throw new Error(`swSynthetic --list returned non-contiguous inventory; count=${inventory.length} lastIndex=${lastIndex}`)
  }
  return inventory
}

function buildSyntheticRangeCommands(totalTests, shardCount) {
  const normalizedShardCount = Math.max(1, Math.min(totalTests, shardCount))
  const shardSize = Math.ceil(totalTests / normalizedShardCount)
  const commands = []
  for (let start = 1; start <= totalTests; start += shardSize) {
    const end = Math.min(totalTests, start + shardSize - 1)
    commands.push(['node', 'test/swSynthetic.test.js', `--range=${start}:${end}`])
  }
  return commands
}

function prepareSyntheticLane() {
  const syntheticLaneIndex = lanes.findIndex(lane => lane.name === 'synthetic')
  if (syntheticLaneIndex < 0) {
    return
  }
  const inventory = getSyntheticTestInventory()
  const commands = buildSyntheticRangeCommands(inventory.length, getSyntheticShardCount())
  const syntheticLanes = commands.map((command, index) => ({
    name: `synthetic-${index + 1}`,
    commandTimeoutMs: 1200000,
    commands: [command],
    testCount: inventory.length,
    shardCount: commands.length
  }))
  lanes.splice(syntheticLaneIndex, 1, ...syntheticLanes)
}

function formatCommand(command) {
  return command.join(' ')
}

function formatDuration(ms) {
  if (ms < 1000) {
    return `${ms}ms`
  }
  return `${(ms / 1000).toFixed(1)}s`
}

function getDefaultLaneConcurrency() {
  const available = typeof os.availableParallelism === 'function'
    ? os.availableParallelism()
    : os.cpus().length
  const normalizedAvailable = Number.isFinite(available) && available > 0 ? available : 1
  return Math.max(1, Math.min(lanes.length, normalizedAvailable, 4))
}

function getLaneConcurrency() {
  const raw = `${process.env.TEST_PARALLEL_JOBS || ''}`.trim()
  if (!raw) {
    return getDefaultLaneConcurrency()
  }
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 1) {
    console.warn(`Ignoring invalid TEST_PARALLEL_JOBS=${JSON.stringify(raw)}; using default concurrency`)
    return getDefaultLaneConcurrency()
  }
  return Math.max(1, Math.min(lanes.length, parsed))
}

async function runLanesWithLimit(limit) {
  const results = new Array(lanes.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < lanes.length) {
      const laneIndex = nextIndex
      nextIndex += 1
      results[laneIndex] = await runLane(lanes[laneIndex])
    }
  }

  const workerCount = Math.max(1, Math.min(limit, lanes.length))
  await Promise.all(Array.from({length: workerCount}, () => worker()))
  return results
}

function writePrefixedLine(laneName, text, stream) {
  stream.write(`[${laneName}] ${text}\n`)
}

function prefixStream(readable, laneName, stream) {
  let buffered = ''
  readable.setEncoding('utf8')
  readable.on('data', chunk => {
    buffered += chunk
    const lines = buffered.split(/\r?\n/)
    buffered = lines.pop()
    for (const line of lines) {
      writePrefixedLine(laneName, line, stream)
    }
  })
  return () => {
    if (buffered.length > 0) {
      writePrefixedLine(laneName, buffered, stream)
      buffered = ''
    }
  }
}

function runCommand(laneName, command, timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS) {
  return new Promise(resolve => {
    const startedAt = Date.now()
    const commandText = formatCommand(command)
    let resolved = false
    let timedOut = false
    let killTimer = null
    writePrefixedLine(laneName, `START ${commandText} timeout=${formatDuration(timeoutMs)}`, process.stdout)

    const child = spawn(command[0], command.slice(1), {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    const flushStdout = prefixStream(child.stdout, laneName, process.stdout)
    const flushStderr = prefixStream(child.stderr, laneName, process.stderr)
    const timeoutTimer = setTimeout(() => {
      timedOut = true
      writePrefixedLine(laneName, `TIMEOUT ${commandText} after=${formatDuration(timeoutMs)}`, process.stderr)
      child.kill('SIGTERM')
      killTimer = setTimeout(() => {
        writePrefixedLine(laneName, `TIMEOUT-KILL ${commandText} signal=SIGKILL`, process.stderr)
        child.kill('SIGKILL')
      }, KILL_GRACE_MS)
    }, timeoutMs)

    function finish(result, stream, line) {
      if (resolved) {
        return
      }
      resolved = true
      clearTimeout(timeoutTimer)
      if (killTimer) {
        clearTimeout(killTimer)
      }
      flushStdout()
      flushStderr()
      writePrefixedLine(laneName, line, stream)
      resolve(result)
    }

    child.on('error', err => {
      const durationMs = Date.now() - startedAt
      finish({
          command: commandText,
          durationMs,
          exitCode: null,
          signal: null,
          timedOut,
          error: err
        },
        process.stderr,
        `FAIL ${commandText} spawn-error=${err.message} duration=${formatDuration(durationMs)}`
      )
    })

    child.on('close', (exitCode, signal) => {
      const durationMs = Date.now() - startedAt
      const status = exitCode === 0 && !timedOut ? 'PASS' : 'FAIL'
      const suffix = signal ? ` signal=${signal}` : ` exit=${exitCode}`
      const timeoutSuffix = timedOut ? ' timeout=true' : ''
      finish({
          command: commandText,
          durationMs,
          exitCode,
          signal,
          timedOut,
          error: null
        },
        status === 'PASS' ? process.stdout : process.stderr,
        `${status} ${commandText}${suffix}${timeoutSuffix} duration=${formatDuration(durationMs)}`
      )
    })
  })
}

async function runLane(lane) {
  const startedAt = Date.now()
  const completedCommands = []
  let failedCommand = null

  writePrefixedLine(lane.name, `LANE START commands=${lane.commands.length}`, process.stdout)
  for (const command of lane.commands) {
    const result = await runCommand(lane.name, command, lane.commandTimeoutMs)
    completedCommands.push(result)
    if (result.exitCode !== 0 || result.signal || result.error || result.timedOut) {
      failedCommand = result
      writePrefixedLine(lane.name, `LANE FAIL firstFailure="${result.command}"`, process.stderr)
      break
    }
  }

  const durationMs = Date.now() - startedAt
  const passed = failedCommand === null
  writePrefixedLine(lane.name, `LANE ${passed ? 'PASS' : 'FAIL'} duration=${formatDuration(durationMs)}`, passed ? process.stdout : process.stderr)

  return {
    name: lane.name,
    commandCount: lane.commands.length,
    completedCount: completedCommands.length,
    passed,
    durationMs,
    failedCommand
  }
}

async function main() {
  prepareSyntheticLane()

  console.log('parallel test lanes:')
  for (const lane of lanes) {
    const count = lane.testCount ? ` tests=${lane.testCount}` : ''
    const shard = lane.shardCount ? ` shards=${lane.shardCount}` : ''
    console.log(`- ${lane.name}:${count}${shard} ${lane.commands.map(formatCommand).join(' ; ')}`)
  }

  const laneConcurrency = getLaneConcurrency()
  console.log(`lane concurrency: ${laneConcurrency}/${lanes.length}`)

  const results = await runLanesWithLimit(laneConcurrency)
  const failed = results.filter(result => !result.passed)

  console.log('\nparallel test summary:')
  for (const result of results) {
    const status = result.passed ? 'PASS' : 'FAIL'
    const failure = result.failedCommand ? ` failingCommand="${result.failedCommand.command}"` : ''
    console.log(`- ${result.name}: ${status} commands=${result.completedCount}/${result.commandCount} duration=${formatDuration(result.durationMs)}${failure}`)
  }

  if (failed.length > 0) {
    console.error(`parallel test failed lanes: ${failed.map(result => result.name).join(', ')}`)
    process.exitCode = 1
  }
}

main().catch(err => {
  console.error(err && err.stack ? err.stack : err)
  process.exitCode = 1
})
