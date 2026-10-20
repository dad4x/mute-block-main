#!/usr/bin/env node
// Lists every function in the worker and dashboard modules that reads queue storage, loads a
// projection, replays the WAL, or touches the mirror. Output is a markdown table.
// Usage: node tools/inventory-queue-storage.js [out.md]

const fs = require('fs')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..')
const files = [
    'shared/js/sw.js',
    'shared/js/coordinator.js',
    'shared/js/swBootstrap.js',
    'shared/js/swCoordinatorQueueView.js',
    'shared/js/swqueueRuntime.js'
]
const patterns = [
    ['metricStorageGet', /metricStorageGet\(/],
    ['storageAdapter.get', /coordinatorStorageAdapter\.get\(/],
    ['queue projection load', /loadCoordinatorQueue\w*Projection\(/],
    ['current authority load', /loadCoordinatorCurrentAuthorityState\(/],
    ['dashboard snapshot', /loadCoordinatorDashboardAuthoritySnapshot\(/],
    ['WAL replay', /recoverProjectedState\(/],
    ['WAL segment hydrate', /hydrateSegmentedWalStore\(/],
    ['WAL queue recovery', /recoverCoordinatorQueueFromWal\(/],
    ['mirror read', /readCoordinatorQueueRowsFromMirror\(/],
    ['mirror rebuild', /rebuildCoordinatorQueueMirrorFromDisk\(/],
    ['keyed row project', /projectKeyedRowFromStored\(/]
]

const rows = new Map()
for (const file of files) {
    const lines = fs.readFileSync(path.join(repoRoot, file), 'utf8').split('\n')
    const enclosingFunction = index => {
        for (let i = index; i >= 0; i -= 1) {
            const match = lines[i].match(/^\s*(?:async )?function (\w+)/)
            if (match) return match[1]
        }
        return '(top level)'
    }
    lines.forEach((line, index) => {
        if (/^\s*\/\//.test(line)) return
        for (const [name, pattern] of patterns) {
            if (!pattern.test(line)) continue
            const key = `${path.basename(file)} :: ${enclosingFunction(index)}`
            if (!rows.has(key)) rows.set(key, {first: index + 1, calls: new Set()})
            rows.get(key).calls.add(name)
        }
    })
}

const sorted = [...rows.entries()].sort((a, b) => a[0].localeCompare(b[0]))
const markdown = ['| Module :: function | First line | Storage / WAL calls |', '|---|---|---|']
for (const [key, value] of sorted) {
    markdown.push(`| ${key} | ${value.first} | ${[...value.calls].join(', ')} |`)
}
const output = markdown.join('\n') + '\n'
if (process.argv[2]) {
    fs.writeFileSync(path.resolve(process.argv[2]), output)
    console.log(`wrote ${sorted.length} functions to ${process.argv[2]}`)
} else {
    process.stdout.write(output)
}
