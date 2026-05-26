const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const {
    EVENT_TYPES,
    POLICY_ACTIONS,
    classifySourceRelationship,
    collectProfileModerationInputs,
    collectSpaceRecommendations,
    makeLocalSpaceClassificationEvent,
    normalizeClassification,
    normalizeEventJournal,
    normalizePolicyAction,
    normalizeProfileTransportSubject,
    normalizeSpaceUrl,
    parseMblockBlocks,
    reduceImportInbox,
    reduceExportState,
    reduceSpaceRecommendationInbox,
    renderMblockDocument,
    resolveLabelPolicyAction,
    shouldExportPendingEvents,
    validateEventJournal,
    validateRoamingProfile,
    verifyPostedProof
} = require('../shared/js/sharedModeration')

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'shared-moderation')

function readFixture(name) {
    return fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8')
}

function readJsonFixture(name) {
    return JSON.parse(readFixture(name))
}

function test(name, fn) {
    try {
        fn()
        console.log(`ok - ${name}`)
    }
    catch(error) {
        console.error(`not ok - ${name}`)
        throw error
    }
}

test('parses valid MBLOCK text and exposes the embedded journal', () => {
    const blocks = parseMblockBlocks(readFixture('mblock-valid.txt'))
    assert.equal(blocks.length, 1)
    assert.equal(blocks[0].ok, true)
    assert.equal(blocks[0].version, 1)
    assert.equal(blocks[0].document.document_id, 'mbj:fixture:2026-05-20:text')
})

test('reports malformed MBLOCK JSON without throwing', () => {
    const blocks = parseMblockBlocks(readFixture('mblock-malformed-json.txt'))
    assert.equal(blocks.length, 1)
    assert.equal(blocks[0].ok, false)
    assert.match(blocks[0].error, /JSON/)
})

test('parses multiple MBLOCK documents from one rendered post', () => {
    const blocks = parseMblockBlocks(readFixture('mblock-multiple-blocks.txt'))
    assert.equal(blocks.length, 2)
    assert.equal(blocks.every(block => block.ok), true)
    assert.deepEqual(blocks.map(block => block.document.document_id), [
        'mbj:fixture:2026-05-20:multi-001',
        'mbj:fixture:2026-05-20:multi-002'
    ])
})

test('parses MBLOCK documents separated by ordinary paragraphs', () => {
    const blocks = parseMblockBlocks(readFixture('mblock-extra-paragraphs.txt'))
    assert.equal(blocks.length, 2)
    assert.equal(blocks.every(block => block.ok), true)
    assert.deepEqual(blocks.map(block => block.document.document_id), [
        'mbj:fixture:2026-05-20:paragraphs-001',
        'mbj:fixture:2026-05-20:paragraphs-002'
    ])
})

test('ignores JSON-looking text outside MBLOCK markers', () => {
    const blocks = parseMblockBlocks(readFixture('mblock-json-looking-outside.txt'))
    assert.equal(blocks.length, 1)
    assert.equal(blocks[0].ok, true)
    assert.equal(blocks[0].document.document_id, 'mbj:fixture:2026-05-20:json-looking-outside')
})

test('ignores truncated MBLOCK end markers', () => {
    const blocks = parseMblockBlocks(readFixture('mblock-truncated-end.txt'))
    assert.equal(blocks.length, 0)
})

test('parses Quora-rendered MBLOCK text with extra whitespace', () => {
    const blocks = parseMblockBlocks(readFixture('mblock-quora-whitespace.txt'))
    assert.equal(blocks.length, 1)
    assert.equal(blocks[0].ok, true)
    assert.equal(blocks[0].document.document_id, 'mbj:fixture:2026-05-20:whitespace')
    assert.equal(validateEventJournal(blocks[0].document).ok, true)
})

test('renders an MBLOCK document that can be parsed back', () => {
    const journal = readJsonFixture('event-journal-valid.json')
    const blocks = parseMblockBlocks(renderMblockDocument(journal))
    assert.equal(blocks.length, 1)
    assert.equal(blocks[0].ok, true)
    assert.deepEqual(blocks[0].document, journal)
})

test('validates event journals and normalizes transport subjects', () => {
    const journal = readJsonFixture('event-journal-valid.json')
    const validation = validateEventJournal(journal)
    assert.equal(validation.ok, true)

    const normalized = normalizeEventJournal(journal)
    assert.equal(normalized.ok, true)
    assert.equal(normalized.duplicateEventIds.length, 0)
    assert.equal(
        normalized.journal.events[0].canonical_subject,
        'https://www.quora.com/profile/Some-User'
    )
})

test('deduplicates repeated event ids during journal normalization', () => {
    const journal = readJsonFixture('event-journal-duplicate-event.json')
    const normalized = normalizeEventJournal(journal)
    assert.equal(normalized.ok, true)
    assert.deepEqual(normalized.duplicateEventIds, ['evt-fixture-duplicate'])
    assert.equal(normalized.journal.events.length, 1)
})

test('rejects invalid event type and missing profile subject', () => {
    const invalid = {
        schema: 'com.muteblock.eventJournal',
        schema_version: 1,
        document_id: 'bad',
        publisher: {quora_profile: 'quora-profile:Mock'},
        events: [{
            event_id: 'bad-event',
            type: 'profile.block.add',
            subject: ''
        }, {
            event_id: 'bad-type',
            type: 'profile.block.force',
            subject: 'quora-profile:Some-User'
        }]
    }
    const validation = validateEventJournal(invalid)
    assert.equal(validation.ok, false)
    assert.ok(validation.errors.some(error => error.includes('subject')))
    assert.ok(validation.errors.some(error => error.includes('type')))
})

test('rejects hostile event-journal fixtures', () => {
    const wrongVersion = validateEventJournal(readJsonFixture('event-journal-wrong-schema-version.json'))
    assert.equal(wrongVersion.ok, false)
    assert.ok(wrongVersion.errors.some(error => error.includes('schema_version')))

    const missingPublisher = validateEventJournal(readJsonFixture('event-journal-missing-publisher.json'))
    assert.equal(missingPublisher.ok, false)
    assert.ok(missingPublisher.errors.some(error => error.includes('publisher')))

    const rewrittenSubject = validateEventJournal(readJsonFixture('event-journal-url-rewritten-subject.json'))
    assert.equal(rewrittenSubject.ok, false)
    assert.ok(rewrittenSubject.errors.some(error => error.includes('subject')))
})

test('validates roaming profiles and rejects browser-specific fields', () => {
    assert.equal(validateRoamingProfile(readJsonFixture('roaming-profile-valid.json')).ok, true)

    const invalid = validateRoamingProfile(readJsonFixture('roaming-profile-forbidden-fields.json'))
    assert.equal(invalid.ok, false)
    assert.ok(invalid.errors.some(error => error.includes('source_instance')))
    assert.ok(invalid.errors.some(error => error.includes('queue_state')))
    assert.ok(invalid.errors.some(error => error.includes('machine_name')))

    const nested = validateRoamingProfile(readJsonFixture('roaming-profile-forbidden-nested-array.json'))
    assert.equal(nested.ok, false)
    assert.ok(nested.errors.some(error => error.includes('settings.profiles[0].storage_profile_id')))
    assert.ok(nested.errors.some(error => error.includes('settings.history[0].execution_history')))
})

test('normalizes profile transport subjects and space URLs', () => {
    assert.equal(
        normalizeProfileTransportSubject('quora-profile:Some-User'),
        'https://www.quora.com/profile/Some-User'
    )
    assert.equal(
        normalizeProfileTransportSubject('https://www.quora.com/profile/Some-User/answers'),
        'https://www.quora.com/profile/Some-User'
    )
    assert.equal(normalizeProfileTransportSubject('https://example.com/profile/Some-User'), '')
    assert.equal(normalizeSpaceUrl('http://target-space.quora.com/?x=1#frag'), 'https://target-space.quora.com/')
})

test('normalizes classification category and mode', () => {
    assert.deepEqual(normalizeClassification({category: 'Target', mode: 'Reviewed'}), {
        category: 'target',
        mode: 'reviewed'
    })
    assert.deepEqual(normalizeClassification({category: 'asset', mode: 'bad'}), {
        category: 'asset',
        mode: 'manual'
    })
    assert.deepEqual(normalizeClassification({category: 'neutral', mode: 'dead-hand'}), {
        category: 'neutral',
        mode: ''
    })
    assert.equal(normalizeClassification({category: 'other'}), null)
})

test('normalizes local policy actions', () => {
    for(const action of Object.values(POLICY_ACTIONS)) {
        assert.equal(normalizePolicyAction(action), action)
    }
    assert.equal(normalizePolicyAction('Mute_Block'), POLICY_ACTIONS.MUTE_BLOCK)
    assert.equal(normalizePolicyAction('bad-action', POLICY_ACTIONS.WARN), POLICY_ACTIONS.WARN)
    assert.equal(normalizePolicyAction('bad-action', 'also-bad'), POLICY_ACTIONS.IGNORE)
})

test('resolves imported labels through local policy without executing actions', () => {
    const input = readJsonFixture('label-policy-input.json')
    const resolved = resolveLabelPolicyAction(input.labels, input.policy)
    assert.equal(resolved.action, POLICY_ACTIONS.MUTE_BLOCK)
    assert.deepEqual(resolved.matched.map(match => match.action), [
        POLICY_ACTIONS.WARN,
        POLICY_ACTIONS.QUEUE,
        POLICY_ACTIONS.MUTE_BLOCK
    ])

    assert.equal(
        resolveLabelPolicyAction([{src: 'did:example:trusted', val: 'quora-watch'}], {
            actionsBySource: {'did:example:trusted': POLICY_ACTIONS.WARN}
        }).action,
        POLICY_ACTIONS.WARN
    )
    assert.equal(
        resolveLabelPolicyAction([{src: 'did:example:unknown', val: 'unknown'}]).action,
        POLICY_ACTIONS.IGNORE
    )
    assert.equal(
        resolveLabelPolicyAction([{src: 'did:example:trusted', val: 'quora-noisy'}], {
            actionsByLabel: {'quora-noisy': POLICY_ACTIONS.MUTE}
        }).action,
        POLICY_ACTIONS.MUTE
    )
    assert.equal(
        resolveLabelPolicyAction([{src: 'did:example:strict', val: 'quora-impersonation'}], {
            actionsByLabel: {'quora-impersonation': POLICY_ACTIONS.BLOCK}
        }).action,
        POLICY_ACTIONS.BLOCK
    )
})

test('classifies source relationship from publisher identity', () => {
    const journal = readJsonFixture('event-journal-valid.json')
    assert.equal(classifySourceRelationship(journal, {quora_profile: 'quora-profile:Mock-Publisher'}), 'self')
    assert.equal(classifySourceRelationship(journal, {quora_profile: 'quora-profile:Other'}), 'external')
    assert.equal(classifySourceRelationship({publisher: {}}, {}), 'unknown')
})

test('decides automatic and manual export thresholds', () => {
    assert.deepEqual(shouldExportPendingEvents(3, {minimumAutoExportEvents: 10}), {
        shouldExport: false,
        reason: 'skipped-low-volume'
    })
    assert.deepEqual(shouldExportPendingEvents(10, {minimumAutoExportEvents: 10}), {
        shouldExport: true,
        reason: 'threshold-met'
    })
    assert.deepEqual(shouldExportPendingEvents(1, {minimumAutoExportEvents: 10, manual: true}), {
        shouldExport: true,
        reason: 'manual'
    })
})

test('posted proof must contain the document and all event ids', () => {
    const journal = readJsonFixture('event-journal-valid.json')
    const proof = readJsonFixture('posted-proof-valid.json')
    assert.equal(verifyPostedProof(journal, proof).ok, true)

    const bad = verifyPostedProof(journal, {
        ...proof,
        verified_event_ids: ['evt-fixture-block-001']
    })
    assert.equal(bad.ok, false)
    assert.ok(bad.errors.some(error => error.includes('evt-fixture-space-001')))
})

test('export reducer marks attempting, exported, and failed states', () => {
    const events = readJsonFixture('event-journal-valid.json').events
    const eventIds = events.map(event => event.event_id)
    const attempting = reduceExportState(events, {
        type: 'attempt',
        eventIds,
        attemptId: 'export-attempt-1',
        at: '2026-05-20T00:03:00Z'
    })
    assert.equal(attempting[0].export_status, 'attempting')

    const exported = reduceExportState(attempting, {
        type: 'proof',
        proof: readJsonFixture('posted-proof-valid.json'),
        at: '2026-05-20T00:05:00Z'
    })
    assert.equal(exported[0].export_status, 'exported')
    assert.equal(exported[1].export_document_id, 'mbj:fixture:2026-05-20:001')

    const failed = reduceExportState(attempting, {
        type: 'failure',
        eventIds: [eventIds[0]],
        error: 'needs-user'
    })
    assert.equal(failed[0].export_status, 'pending')
    assert.equal(failed[0].export_error, 'needs-user')
})

test('collects external profile moderation inputs without queue execution fields', () => {
    const input = readJsonFixture('import-inbox-input.json')
    const collected = collectProfileModerationInputs(input.journals, {
        localPublisher: input.localPublisher
    })
    assert.equal(collected.length, 2)
    assert.deepEqual(collected.map(item => item.eventType), [
        EVENT_TYPES.PROFILE_BLOCK_ADD,
        EVENT_TYPES.PROFILE_MUTE_ADD
    ])
    assert.equal(
        collected.some(item => item.sourceDocumentId === 'mbj:fixture:2026-05-20:import-self'),
        false
    )
    assert.equal(
        collected.every(item => item.sourceRelationship === 'external'),
        true
    )
    for(const item of collected) {
        assert.equal(item.status, 'new')
        assert.equal(Object.prototype.hasOwnProperty.call(item, 'queueAction'), false)
        assert.equal(Object.prototype.hasOwnProperty.call(item, 'executorAction'), false)
        assert.equal(Object.prototype.hasOwnProperty.call(item, 'queuedAt'), false)
    }

    assert.equal(collectProfileModerationInputs(input.journals, {
        localPublisher: input.localPublisher,
        dismissedInputKeys: [collected[0].key]
    }).length, 1)
})

test('import inbox reducer imports, dismisses, and applies idempotently', () => {
    const input = readJsonFixture('import-inbox-input.json')
    const collected = collectProfileModerationInputs(input.journals, {
        localPublisher: input.localPublisher
    })

    const imported = reduceImportInbox({}, {
        type: 'import',
        inputs: collected,
        at: '2026-05-20T01:00:00Z'
    })
    assert.equal(imported.items.length, 2)
    assert.equal(imported.items[0].importedAt, '2026-05-20T01:00:00Z')

    const importedAgain = reduceImportInbox(imported, {
        type: 'import',
        inputs: collected,
        at: '2026-05-20T02:00:00Z'
    })
    assert.deepEqual(importedAgain, imported)

    const dismissed = reduceImportInbox(imported, {
        type: 'dismiss',
        key: collected[0].key,
        at: '2026-05-20T03:00:00Z'
    })
    assert.equal(dismissed.items[0].status, 'dismissed')
    assert.equal(dismissed.items[0].dismissedAt, '2026-05-20T03:00:00Z')
    assert.deepEqual(reduceImportInbox(dismissed, {
        type: 'dismiss',
        key: collected[0].key,
        at: '2026-05-20T04:00:00Z'
    }), dismissed)

    const applied = reduceImportInbox(dismissed, {
        type: 'apply',
        key: collected[1].key,
        localEventId: 'local-accept-001',
        at: '2026-05-20T05:00:00Z'
    })
    assert.equal(applied.items[1].status, 'applied')
    assert.equal(applied.items[1].appliedLocalEventId, 'local-accept-001')
    assert.deepEqual(reduceImportInbox(applied, {
        type: 'apply',
        key: collected[1].key,
        localEventId: 'local-accept-002',
        at: '2026-05-20T06:00:00Z'
    }), applied)
})

test('collects external space classification recommendations only', () => {
    const external = readJsonFixture('event-journal-valid.json')
    const self = {
        ...external,
        document_id: 'self-document',
        publisher: {
            quora_profile: 'quora-profile:Self',
            atproto_did: null,
            display_name: 'Self'
        },
        events: [{
            event_id: 'self-space-event',
            type: EVENT_TYPES.SPACE_CLASSIFICATION_SET,
            space: 'https://self-space.quora.com/',
            classification: {
                category: 'asset',
                mode: 'manual'
            }
        }]
    }
    const recommendations = collectSpaceRecommendations([external, self], {
        localPublisher: {quora_profile: 'quora-profile:Self'}
    })
    assert.equal(recommendations.length, 1)
    assert.equal(recommendations[0].space, 'https://target-space.quora.com/')
    assert.deepEqual(recommendations[0].classification, {
        category: 'target',
        mode: 'reviewed'
    })

    const dismissed = collectSpaceRecommendations([external], {
        dismissedRecommendationKeys: [recommendations[0].key]
    })
    assert.equal(dismissed.length, 0)
})

test('space recommendation inbox applies recommendations as local events only', () => {
    const external = readJsonFixture('event-journal-valid.json')
    const recommendations = collectSpaceRecommendations([external], {
        localPublisher: {quora_profile: 'quora-profile:Self'}
    })
    assert.equal(recommendations.length, 1)

    const imported = reduceSpaceRecommendationInbox({}, {
        type: 'import',
        recommendations,
        at: '2026-05-20T07:00:00Z'
    })
    assert.equal(imported.items.length, 1)
    assert.equal(imported.items[0].status, 'new')
    assert.equal(imported.items[0].importedAt, '2026-05-20T07:00:00Z')

    const importedAgain = reduceSpaceRecommendationInbox(imported, {
        type: 'import',
        recommendations,
        at: '2026-05-20T08:00:00Z'
    })
    assert.deepEqual(importedAgain, imported)

    const localEvent = makeLocalSpaceClassificationEvent(imported.items[0], {
        eventId: 'local-space-accept-001',
        at: '2026-05-20T09:00:00Z'
    })
    assert.equal(localEvent.ok, true)
    assert.deepEqual(localEvent.event, {
        event_id: 'local-space-accept-001',
        type: EVENT_TYPES.SPACE_CLASSIFICATION_SET,
        space: 'https://target-space.quora.com/',
        classification: {
            category: 'target',
            mode: 'reviewed'
        },
        occurred_at: '2026-05-20T09:00:00Z',
        accepted_recommendation_key: imported.items[0].key,
        accepted_source_documents: ['mbj:fixture:2026-05-20:001']
    })
    assert.equal(Object.prototype.hasOwnProperty.call(localEvent.event, 'queueAction'), false)

    const applied = reduceSpaceRecommendationInbox(imported, {
        type: 'apply',
        key: imported.items[0].key,
        localEventId: localEvent.event.event_id,
        at: '2026-05-20T09:00:00Z'
    })
    assert.equal(applied.items[0].status, 'applied')
    assert.equal(applied.items[0].appliedLocalEventId, 'local-space-accept-001')

    const dismissed = reduceSpaceRecommendationInbox(imported, {
        type: 'dismiss',
        key: imported.items[0].key,
        at: '2026-05-20T10:00:00Z'
    })
    assert.equal(dismissed.items[0].status, 'dismissed')
    assert.deepEqual(reduceSpaceRecommendationInbox(dismissed, {
        type: 'dismiss',
        key: imported.items[0].key,
        at: '2026-05-20T11:00:00Z'
    }), dismissed)
})

test('keeps separate recommendations from different publishers and modes', () => {
    const base = readJsonFixture('event-journal-valid.json')
    const otherMode = {
        ...base,
        document_id: 'other-mode-document',
        publisher: {
            quora_profile: 'quora-profile:Other-Publisher',
            atproto_did: null,
            display_name: 'Other Publisher'
        },
        events: [{
            event_id: 'other-mode-event',
            type: EVENT_TYPES.SPACE_CLASSIFICATION_SET,
            space: 'https://target-space.quora.com/',
            classification: {
                category: 'target',
                mode: 'dead-hand'
            },
            occurred_at: '2026-05-20T00:02:00Z'
        }]
    }
    const recommendations = collectSpaceRecommendations([base, otherMode], {
        localPublisher: {quora_profile: 'quora-profile:Self'}
    })
    assert.equal(recommendations.length, 2)
    assert.deepEqual(
        recommendations.map(recommendation => recommendation.classification.mode).sort(),
        ['dead-hand', 'reviewed']
    )
})

test('ignores unknown-source journals when collecting recommendations', () => {
    const base = readJsonFixture('event-journal-valid.json')
    const unknown = {
        ...base,
        document_id: 'unknown-document',
        publisher: {}
    }
    assert.equal(collectSpaceRecommendations([unknown]).length, 0)
})
