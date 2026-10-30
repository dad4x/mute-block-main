#!/usr/bin/env node
// Guard for "no writes outside the worker" (docs/queue-storage-layering.md, section 14). Every file in shared/js except the
// worker's own (sw*.js) may not write any storage: chrome/browser storage set, remove or clear, storageArea writes, or
// localStorage/sessionStorage writes. Such a page asks the worker by message instead. There is no allowlist: the owner does
// not tolerate outside writes, so a new one fails the lint rather than being listed.
//
// Usage: node tools/lint-no-outside-writes.js   (exit 1 on any write outside the worker)

const fs = require('fs')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..')
const jsDir = path.join(repoRoot, 'shared/js')
const writePatterns = [
    /\b(?:browser|chrome)\.storage\.(?:local|session|sync|managed)\.(?:set|remove|clear)\s*\(/,
    /\bstorageArea\.(?:set|remove|clear)\s*\(/,
    /\b(?:localStorage|sessionStorage)\.(?:setItem|removeItem|clear)\s*\(/
]

// Comment lines describe writes; they are not writes. Strings that merely name a call have no "(" after the name.
function isCommentLine(line) {
    const trimmed = line.trim()
    return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')
}

const files = fs.readdirSync(jsDir)
    .filter(name => name.endsWith('.js') && !name.startsWith('sw'))
    .sort()

const violations = []
for (const name of files) {
    const lines = fs.readFileSync(path.join(jsDir, name), 'utf8').split('\n')
    lines.forEach((line, index) => {
        if (isCommentLine(line)) return
        if (!writePatterns.some(pattern => pattern.test(line))) return
        violations.push(`shared/js/${name}:${index + 1}: ${line.trim().slice(0, 120)}`)
    })
}

if (violations.length) {
    console.error('storage writes outside the worker (page code must send a message to the worker instead):')
    for (const violation of violations) console.error(`  ${violation}`)
    process.exit(1)
}
console.log(`no writes outside the worker in ${files.length} page modules`)
