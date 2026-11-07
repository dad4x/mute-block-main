#!/usr/bin/env node

// Converts a collected Quora profile list (output of tools/cdp/collect-quora-blocked-list.js) into the proposed exchange format
// from atproto-moderation-model.md ("Proposed mute-block-main Translation"): a Lists document with a modlist.
// Transport "json" writes the Lists document with canonical https profile URLs. Transport "mblock" writes the MBLOCK:BEGIN v=1 block
// for a Quora post, with subjects encoded as quora-profile:<slug>, as that note requires for Quora post transport.
// Read-only on its input. Writes only the output file named by --out.
//
// Usage: node tools/export-quora-list-exchange.js --in=<raw.json> --out=<file> [--transport=json|mblock]
//        [--source=<source id>] [--list-id=<id>] [--list-name=<name>]
const fs = require('fs')
const path = require('path')
const {getOption} = require('./cdp/lib/cdp')

const ORIGIN = 'https://www.quora.com'

function profileSlug(url) {
    const parts = String(url || '').split('/').filter(Boolean)
    return parts[parts.length - 1] || ''
}

function canonicalUrl(url) {
    const path_ = String(url || '').replace(/^https?:\/\/www\.quora\.com/, '')
    return ORIGIN + path_
}

const inPath = getOption('in', '')
const outPath = getOption('out', '')
if (!inPath || !outPath) {
    console.error('usage: --in=<raw.json> --out=<file> [--transport=json|mblock]')
    process.exit(2)
}
const transport = getOption('transport', 'json')
if (transport !== 'json' && transport !== 'mblock') {
    console.error('transport must be json or mblock')
    process.exit(2)
}
const raw = JSON.parse(fs.readFileSync(inPath, 'utf8'))
if (raw.end !== 'hasNextPage=false' || raw.duplicateRows !== 0) {
    console.error(`refusing to export an incomplete or duplicated collection: end=${raw.end} duplicateRows=${raw.duplicateRows}`)
    process.exit(1)
}

const seen = new Set()
const canonical = []
for (const row of raw.list) {
    const url = canonicalUrl(row.url)
    if (!/^https:\/\/www\.quora\.com\/profile\//.test(url) || seen.has(url)) continue
    seen.add(url)
    canonical.push(url)
}
canonical.sort()

const source = getOption('source', 'dbrower-local-export')
const listId = getOption('list-id', 'quora-blocked-users')
const listName = getOption('list-name', `Quora blocked users (${raw.account || 'unknown account'})`)
const updatedAt = new Date().toISOString()
const description = `Profiles blocked by the viewer on Quora, collected ${raw.collectedAt} (${canonical.length} profiles). Exported for review; no local action implied.`

let text
if (transport === 'json') {
    const doc = {
        source,
        updated_at: updatedAt,
        lists: [{id: listId, purpose: 'modlist', name: listName, description, profiles: canonical}],
        signature: null
    }
    text = JSON.stringify(doc, null, 2) + '\n'
}
else {
    const subjects = canonical.map(url => `quora-profile:${profileSlug(url)}`)
    const doc = {
        source,
        updated_at: updatedAt,
        lists: [{id: listId, purpose: 'modlist', name: listName, description, profiles: subjects}],
        signature: null
    }
    text = `MBLOCK:BEGIN v=1\n${JSON.stringify(doc)}\nMBLOCK:END\n`
}

fs.mkdirSync(path.dirname(path.resolve(outPath)), {recursive: true})
fs.writeFileSync(outPath, text)
console.log(JSON.stringify({transport, profiles: canonical.length, sourceRows: raw.list.length, out: outPath}, null, 2))
