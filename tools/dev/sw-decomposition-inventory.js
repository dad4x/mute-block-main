#!/usr/bin/env node
// Regenerates the sw.js top-level function inventory used by
// sw-state-machine-decomposition-plan-2026-09-01.md to size and pick the
// next extraction slice. Bucket assignment is a naming-convention guess,
// not a verified classification -- read the function before trusting its
// bucket.
//
// Usage: node tools/dev/sw-decomposition-inventory.js > sw-decomposition-inventory.tsv

const fs = require('fs')
const path = require('path')

const swPath = path.join(__dirname, '..', '..', 'shared', 'js', 'sw.js')
const text = fs.readFileSync(swPath, 'utf8')
const lines = text.split('\n')

const defRe = /^(async )?function ([A-Za-z0-9_]+)\(/
const funcs = []
lines.forEach((line, index) => {
    const match = line.match(defRe)
    if(match) funcs.push({line: index + 1, isAsync: Boolean(match[1]), name: match[2]})
})

function bucket(name, isAsync) {
    if(isAsync) return 'async'
    if(/^(is|has|should)[A-Z]/.test(name)) return 'predicate'
    if(/^(make|build|normalize)[A-Z]/.test(name)) return 'builder'
    if(/^(record|increment)[A-Z]/.test(name)) return 'metric-record'
    if(/^(get|summarize|sum)[A-Z]/.test(name)) return 'getter'
    return 'other'
}

const refCounts = new Map()
for(const {name} of funcs) {
    if(refCounts.has(name)) continue
    const re = new RegExp('\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g')
    const count = (text.match(re) || []).length
    refCounts.set(name, count - 1) // subtract the definition itself
}

process.stdout.write('bucket\tfunction\tline\texternal_refs\n')
for(const {line, isAsync, name} of funcs) {
    process.stdout.write(`${bucket(name, isAsync)}\t${name}\t${line}\t${refCounts.get(name)}\n`)
}
