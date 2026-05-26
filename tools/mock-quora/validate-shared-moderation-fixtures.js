#!/usr/bin/env node

const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const {
    EVENT_JOURNAL_SCHEMA,
    ROAMING_PROFILE_SCHEMA,
    parseMblockBlocks,
    validateEventJournal,
    validateRoamingProfile
} = require('../../shared/js/sharedModeration')

const FIXTURE_DIR = path.join(__dirname, '..', '..', 'test', 'fixtures', 'shared-moderation')
const MANIFEST_NAME = 'fixture-manifest.json'

function readFixture(name) {
    return fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8')
}

function readManifest() {
    const manifest = JSON.parse(readFixture(MANIFEST_NAME))
    assert.ok(Array.isArray(manifest.fixtures), 'fixture manifest must contain a fixtures array')
    return manifest.fixtures
}

function assertManifestCoversFiles(entries) {
    const listed = new Set(entries.map(entry => entry.name))
    const actual = fs.readdirSync(FIXTURE_DIR)
        .filter(name => name !== 'README.md' && name !== MANIFEST_NAME)
        .sort()
    assert.deepEqual(Array.from(listed).sort(), actual, 'fixture manifest must list every fixture file exactly once')
}

function validateFixture(entry) {
    const {name, kind, expectedOk} = entry
    assert.equal(typeof name, 'string', 'fixture entry name must be a string')
    assert.equal(typeof kind, 'string', `${name} fixture entry kind must be a string`)
    assert.equal(typeof expectedOk, 'boolean', `${name} fixture entry expectedOk must be boolean`)
    assert.ok(fs.existsSync(path.join(FIXTURE_DIR, name)), `${name} listed in manifest does not exist`)

    if(kind === 'eventJournal') {
        const document = JSON.parse(readFixture(name))
        assert.equal(document.schema, EVENT_JOURNAL_SCHEMA, `${name} must use event journal schema`)
        const validation = validateEventJournal(document)
        assert.equal(validation.ok, expectedOk, `${name} event journal validation mismatch: ${validation.errors.join('; ')}`)
        return {name, kind, expectedOk, ok: validation.ok, errors: validation.errors}
    }

    if(kind === 'roamingProfile') {
        const document = JSON.parse(readFixture(name))
        assert.equal(document.schema, ROAMING_PROFILE_SCHEMA, `${name} must use roaming profile schema`)
        const validation = validateRoamingProfile(document)
        assert.equal(validation.ok, expectedOk, `${name} roaming profile validation mismatch: ${validation.errors.join('; ')}`)
        return {name, kind, expectedOk, ok: validation.ok, errors: validation.errors}
    }

    if(kind === 'mblockText') {
        const blocks = parseMblockBlocks(readFixture(name))
        const ok = blocks.length > 0 && !blocks.some(block => !block.ok)
        assert.equal(ok, expectedOk, `${name} MBLOCK expectation mismatch`)
        return {
            name,
            kind,
            expectedOk,
            ok,
            blockCount: blocks.length,
            errors: blocks.filter(block => !block.ok).map(block => block.error)
        }
    }

    if(kind === 'json') {
        JSON.parse(readFixture(name))
        assert.equal(expectedOk, true, `${name} generic JSON fixtures must currently be expected valid`)
        return {name, kind, expectedOk, ok: true, errors: []}
    }

    throw new Error(`${name} has unknown fixture kind ${kind}`)
}

function summarizeResults(results) {
    return results.reduce((summary, result) => {
        summary.checked += 1
        summary.expectedValid += result.expectedOk ? 1 : 0
        summary.expectedInvalid += result.expectedOk ? 0 : 1
        summary.actualValid += result.ok ? 1 : 0
        summary.actualInvalid += result.ok ? 0 : 1
        summary.byKind[result.kind] = (summary.byKind[result.kind] || 0) + 1
        return summary
    }, {
        checked: 0,
        expectedValid: 0,
        expectedInvalid: 0,
        actualValid: 0,
        actualInvalid: 0,
        byKind: {}
    })
}

function main() {
    const entries = readManifest()
    assertManifestCoversFiles(entries)
    const results = entries.map(validateFixture)

    console.log(JSON.stringify({
        ok: true,
        fixtureDir: FIXTURE_DIR,
        manifest: path.join(FIXTURE_DIR, MANIFEST_NAME),
        checked: results.length,
        summary: summarizeResults(results),
        results
    }, null, 2))
}

main()
