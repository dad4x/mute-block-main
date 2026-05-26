const assert = require('node:assert/strict')
const {
    EVENT_TYPES,
    normalizeEventJournal,
    parseMblockBlocks,
    renderMblockDocument,
    validateRoamingProfile
} = require('../shared/js/sharedModeration')

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

function mulberry32(seed) {
    let value = seed >>> 0
    return function random() {
        value += 0x6D2B79F5
        let next = value
        next = Math.imul(next ^ next >>> 15, next | 1)
        next ^= next + Math.imul(next ^ next >>> 7, next | 61)
        return ((next ^ next >>> 14) >>> 0) / 4294967296
    }
}

function int(random, max) {
    return Math.floor(random() * max)
}

function pick(random, values) {
    return values[int(random, values.length)]
}

function randomSubject(random, seed, index) {
    return pick(random, [
        `quora-profile:Fuzz-${seed}-${index}`,
        `https://www.quora.com/profile/Fuzz-${seed}-${index}/answers`,
        'Some User',
        'https://example.com/not-quora',
        ''
    ])
}

function randomEvent(random, seed, index) {
    const type = pick(random, [
        EVENT_TYPES.PROFILE_BLOCK_ADD,
        EVENT_TYPES.PROFILE_MUTE_ADD,
        EVENT_TYPES.SPACE_CLASSIFICATION_SET,
        'profile.block.force'
    ])
    const event = {
        event_id: random() < 0.2 ? `evt-${seed}-duplicate` : `evt-${seed}-${index}`,
        type,
        occurred_at: random() < 0.1 ? 'not-a-date' : `2026-05-20T00:${`${index}`.padStart(2, '0')}:00Z`
    }

    if(type === EVENT_TYPES.SPACE_CLASSIFICATION_SET) {
        event.space = pick(random, [
            `https://space-${seed}.quora.com/`,
            `http://space-${seed}.quora.com/?x=1#frag`,
            'https://example.com/not-quora',
            ''
        ])
        event.classification = {
            category: pick(random, ['asset', 'target', 'neutral', 'other']),
            mode: pick(random, ['manual', 'reviewed', 'dead-hand', 'invalid'])
        }
    }
    else {
        event.subject = randomSubject(random, seed, index)
    }

    return event
}

function randomJournal(random, seed) {
    const events = []
    const count = 1 + int(random, 8)
    for(let index = 0; index < count; index += 1) {
        events.push(randomEvent(random, seed, index))
    }
    return {
        schema: random() < 0.1 ? 'bad.schema' : 'com.muteblock.eventJournal',
        schema_version: random() < 0.1 ? 99 : 1,
        document_id: random() < 0.1 ? '' : `mbj:fuzz:${seed}`,
        publisher: random() < 0.1 ? {} : {
            quora_profile: `quora-profile:Fuzz-Publisher-${seed}`,
            atproto_did: null,
            display_name: `Fuzz Publisher ${seed}`
        },
        events
    }
}

test('fuzzes MBLOCK parse and journal normalization without throwing', () => {
    for(let seed = 1; seed <= 100; seed += 1) {
        const random = mulberry32(seed)
        const journal = randomJournal(random, seed)
        const text = [
            'Leading human text',
            random() < 0.2 ? 'MBLOCK:BEGIN v=1\n{"bad":\nMBLOCK:END' : '',
            renderMblockDocument(journal),
            random() < 0.2 ? renderMblockDocument(randomJournal(random, seed + 1000)) : '',
            'Trailing human text'
        ].filter(Boolean).join('\n\n')

        const blocks = parseMblockBlocks(text)
        assert.ok(blocks.length >= 1, `seed ${seed}: expected at least one parsed block`)
        for(const block of blocks) {
            if(block.ok) {
                const normalized = normalizeEventJournal(block.document)
                assert.equal(typeof normalized.ok, 'boolean', `seed ${seed}: normalization should return status`)
            }
        }
    }
})

test('fuzzes roaming-profile forbidden-field recursion without throwing', () => {
    for(let seed = 1; seed <= 100; seed += 1) {
        const random = mulberry32(seed + 5000)
        const profile = {
            schema: 'com.muteblock.roamingProfile',
            schema_version: 1,
            document_id: `mbrp:fuzz:${seed}`,
            publisher: {
                quora_profile: `quora-profile:Fuzz-Publisher-${seed}`,
                atproto_did: null,
                display_name: `Fuzz Publisher ${seed}`
            },
            settings: {
                shared_export_space_url: `https://space-${seed}.quora.com/`,
                wrappers: Array.from({length: 1 + int(random, 4)}, (_, index) => {
                    if(random() < 0.4) return {storage_profile_id: `forbidden-${seed}-${index}`}
                    if(random() < 0.4) return {nested: {queue_state: {private: true}}}
                    return {safe: true}
                })
            }
        }
        const validation = validateRoamingProfile(profile)
        assert.equal(typeof validation.ok, 'boolean', `seed ${seed}: validation should return status`)
    }
})
