#!/usr/bin/env node
// Ratchet for the queue storage layering (docs/queue-storage-layering.md, Phase 1).
//
// A function outside the WAL layer may not read queue storage, load a queue projection, replay the
// WAL, or touch the mirror, unless it is on tools/queue-storage-layering-allowlist.json. The allowlist
// is the set of violations that exist today. Migrating a function means removing it from the list;
// the lint fails while a listed function no longer touches queue storage, so the list only shrinks.
//
// Usage: node tools/lint-queue-storage-layering.js            check (exit 1 on any change)
//        node tools/lint-queue-storage-layering.js --write    regenerate the allowlist from the tree

const fs = require('fs')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..')
const allowlistPath = path.join(repoRoot, 'tools/queue-storage-layering-allowlist.json')
const files = [
    'shared/js/sw.js',
    'shared/js/coordinator.js',
    'shared/js/swBootstrap.js',
    'shared/js/swCoordinatorQueueView.js',
    'shared/js/swqueueRuntime.js'
]
const queuePatterns = [
    /loadCoordinatorQueue\w*Projection\(/,
    /loadCoordinatorCurrentAuthorityState\(/,
    /loadCoordinatorDashboardAuthoritySnapshot\(/,
    /recoverProjectedState\(/,
    /hydrateSegmentedWalStore\(/,
    /recoverCoordinatorQueueFromWal\(/,
    /readCoordinatorQueueRowsFromMirror\(/,
    /rebuildCoordinatorQueueMirrorFromDisk\(/,
    /projectKeyedRowFromStored\(/
]

// The sanctioned doors: the only functions allowed to reference the loaders without being listed. The
// reader is the single seam for queue reads (docs/queue-storage-layering.md, Phase 2-3), and its wiring
// is the one place the seam names the loaders. Adding a door is a design decision, so it is named here
// rather than put on the allowlist, which only shrinks.
const sanctionedDoors = new Set([
    'sw.js::createCoordinatorQueueReader',
    // The hydrate decode (P3): the one full read and the one WAL decode. loadCoordinatorCurrentAuthorityState is called only
    // from here, and the authority's decode failure makes it unavailable (P4). Named, not allowlisted, since it is the door.
    'sw.js::loadResidentState'
])

// The enclosing function is the nearest function declaration above the line. A line with no declaration
// above it is attributed to '<module>', so top-level code is checked too rather than skipped.
function queueTouchingFunctions() {
    const found = new Set()
    for (const file of files) {
        const lines = fs.readFileSync(path.join(repoRoot, file), 'utf8').split('\n')
        const enclosingFunction = index => {
            for (let i = index; i >= 0; i -= 1) {
                const match = lines[i].match(/^\s*(?:async )?function (\w+)/)
                if (match) return match[1]
            }
            return '<module>'
        }
        lines.forEach((line, index) => {
            if (/^\s*\/\//.test(line)) return
            if (!queuePatterns.some(pattern => pattern.test(line))) return
            const key = `${path.basename(file)}::${enclosingFunction(index)}`
            if (sanctionedDoors.has(key)) return
            found.add(key)
        })
    }
    return found
}

const current = queueTouchingFunctions()

if (process.argv.includes('--write')) {
    fs.writeFileSync(allowlistPath, JSON.stringify({allowed: [...current].sort()}, null, 2) + '\n')
    console.log(`wrote ${current.size} allowed entries to ${path.relative(repoRoot, allowlistPath)}`)
    process.exit(0)
}

const allowlist = new Set(JSON.parse(fs.readFileSync(allowlistPath, 'utf8')).allowed)
const newViolations = [...current].filter(name => !allowlist.has(name)).sort()
const staleEntries = [...allowlist].filter(name => !current.has(name)).sort()

if (newViolations.length) {
    console.error('queue storage access outside the WAL layer (not on the allowlist):')
    for (const name of newViolations) console.error(`  ${name}`)
}
if (staleEntries.length) {
    console.error('allowlist entries that no longer touch queue storage (remove them):')
    for (const name of staleEntries) console.error(`  ${name}`)
}
if (newViolations.length || staleEntries.length) process.exit(1)
console.log(`queue storage layering: ${current.size} allowed functions, no new violations`)
