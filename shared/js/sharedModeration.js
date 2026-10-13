const {
    normalizeQuoraProfileHref
} = require('./subject')

const MBLOCK_BEGIN = 'MBLOCK:BEGIN v=1'
const MBLOCK_END = 'MBLOCK:END'

const EVENT_JOURNAL_SCHEMA = 'com.muteblock.eventJournal'
const ROAMING_PROFILE_SCHEMA = 'com.muteblock.roamingProfile'
const SCHEMA_VERSION = 1

const EVENT_TYPES = Object.freeze({
    PROFILE_BLOCK_ADD: 'profile.block.add',
    PROFILE_BLOCK_REMOVE: 'profile.block.remove',
    PROFILE_MUTE_ADD: 'profile.mute.add',
    PROFILE_MUTE_REMOVE: 'profile.mute.remove',
    SPACE_CLASSIFICATION_SET: 'space.classification.set'
})

const POLICY_ACTIONS = Object.freeze({
    IGNORE: 'ignore',
    WARN: 'warn',
    QUEUE: 'queue',
    MUTE: 'mute',
    BLOCK: 'block',
    MUTE_BLOCK: 'mute_block'
})

const VALID_EVENT_TYPES = new Set(Object.values(EVENT_TYPES))
const VALID_POLICY_ACTIONS = new Set(Object.values(POLICY_ACTIONS))
const POLICY_ACTION_RANK = new Map([
    [POLICY_ACTIONS.IGNORE, 0],
    [POLICY_ACTIONS.WARN, 1],
    [POLICY_ACTIONS.QUEUE, 2],
    [POLICY_ACTIONS.MUTE, 3],
    [POLICY_ACTIONS.BLOCK, 4],
    [POLICY_ACTIONS.MUTE_BLOCK, 5]
])
const PROFILE_EVENT_TYPES = new Set([
    EVENT_TYPES.PROFILE_BLOCK_ADD,
    EVENT_TYPES.PROFILE_BLOCK_REMOVE,
    EVENT_TYPES.PROFILE_MUTE_ADD,
    EVENT_TYPES.PROFILE_MUTE_REMOVE
])
const SPACE_CATEGORIES = new Set(['asset', 'neutral', 'target'])
const SPACE_MODES = new Set(['manual', 'reviewed', 'dead-hand'])
const FORBIDDEN_ROAMING_KEYS = new Set([
    'active_tab',
    'browser_label',
    'browser_name',
    'device_label',
    'execution_history',
    'leases',
    'local_ui',
    'machine_name',
    'queue',
    'queue_state',
    'retry_state',
    'source_instance',
    'storage_profile_id',
    'storage_profile_label'
])

function cloneJson(value) {
    if(value === undefined) return undefined
    return JSON.parse(JSON.stringify(value))
}

function stableStringify(value) {
    if(value === null || typeof value !== 'object') return JSON.stringify(value)
    if(Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
}

function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isIsoLikeTimestamp(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)
}

function normalizeProfileTransportSubject(subject = '') {
    const raw = `${subject || ''}`.trim()
    if(!raw) return ''
    if(raw.startsWith('quora-profile:')) {
        const slug = raw.slice('quora-profile:'.length).trim()
        if(!slug || /[/?#\\]/.test(slug)) return ''
        return `https://www.quora.com/profile/${encodeURIComponent(slug)}`
    }
    return normalizeQuoraProfileHref(raw) || ''
}

function normalizeSpaceUrl(space = '') {
    const raw = `${space || ''}`.trim()
    if(!raw) return ''
    try {
        const url = new URL(raw)
        if(!url.hostname.endsWith('.quora.com') && url.hostname !== 'quora.com') return ''
        url.protocol = 'https:'
        url.hash = ''
        url.search = ''
        if(url.pathname === '') url.pathname = '/'
        return url.toString()
    }
    catch {
        return ''
    }
}

function normalizeClassification(classification = {}) {
    const category = `${classification?.category || ''}`.trim().toLowerCase()
    const mode = `${classification?.mode || ''}`.trim().toLowerCase()
    if(!SPACE_CATEGORIES.has(category)) return null
    if(category === 'neutral') return {category: 'neutral', mode: ''}
    return {
        category,
        mode: SPACE_MODES.has(mode) ? mode : 'manual'
    }
}

function normalizePolicyAction(action = '', fallback = POLICY_ACTIONS.IGNORE) {
    const normalized = `${action || ''}`.trim().toLowerCase()
    if(VALID_POLICY_ACTIONS.has(normalized)) return normalized
    return VALID_POLICY_ACTIONS.has(fallback) ? fallback : POLICY_ACTIONS.IGNORE
}

function labelPolicyKeys(label = {}) {
    const source = `${label.src || label.source || ''}`.trim()
    const value = `${label.val || label.label || label.value || ''}`.trim()
    const keys = []
    if(source && value) keys.push(`${source}:${value}`)
    if(value) keys.push(value)
    if(source) keys.push(source)
    return keys
}

function resolveLabelPolicyAction(labels = [], policy = {}) {
    const defaultAction = normalizePolicyAction(policy.defaultAction, POLICY_ACTIONS.IGNORE)
    let selectedAction = defaultAction
    const matched = []

    for(const label of labels || []) {
        const keys = labelPolicyKeys(label)
        let action = ''
        for(const key of keys) {
            if(policy.actionsByKey && Object.prototype.hasOwnProperty.call(policy.actionsByKey, key)) {
                action = policy.actionsByKey[key]
                break
            }
        }
        if(!action && policy.actionsByLabel && (label.val || label.label || label.value)) {
            const value = `${label.val || label.label || label.value}`.trim()
            action = policy.actionsByLabel[value]
        }
        if(!action && policy.actionsBySource && (label.src || label.source)) {
            const source = `${label.src || label.source}`.trim()
            action = policy.actionsBySource[source]
        }

        const normalized = normalizePolicyAction(action, defaultAction)
        if((POLICY_ACTION_RANK.get(normalized) || 0) > (POLICY_ACTION_RANK.get(selectedAction) || 0)) {
            selectedAction = normalized
        }
        if(normalized !== POLICY_ACTIONS.IGNORE) {
            matched.push({
                key: keys[0] || keys[1] || '',
                action: normalized
            })
        }
    }

    return {
        action: selectedAction,
        matched
    }
}

function makeValidationResult(errors = []) {
    return {
        ok: errors.length === 0,
        errors
    }
}

function validatePublisher(publisher = {}, path = 'publisher') {
    const errors = []
    if(!isObject(publisher)) return [`${path} must be an object`]
    if(!publisher.quora_profile && !publisher.atproto_did) {
        errors.push(`${path} must include quora_profile or atproto_did`)
    }
    return errors
}

function validateSharedModerationEvent(event = {}, index = 0) {
    const path = `events[${index}]`
    const errors = []
    if(!isObject(event)) return [`${path} must be an object`]
    if(!event.event_id) errors.push(`${path}.event_id is required`)
    if(!VALID_EVENT_TYPES.has(event.type)) errors.push(`${path}.type is invalid`)
    if(event.occurred_at && !isIsoLikeTimestamp(event.occurred_at)) {
        errors.push(`${path}.occurred_at must be an ISO-like timestamp`)
    }

    if(PROFILE_EVENT_TYPES.has(event.type)) {
        if(!normalizeProfileTransportSubject(event.subject)) {
            errors.push(`${path}.subject must identify a Quora profile`)
        }
    }
    else if(event.type === EVENT_TYPES.SPACE_CLASSIFICATION_SET) {
        if(!normalizeSpaceUrl(event.space)) errors.push(`${path}.space must identify a Quora Space URL`)
        if(!normalizeClassification(event.classification)) {
            errors.push(`${path}.classification is invalid`)
        }
    }

    return errors
}

function validateEventJournal(document = {}) {
    const errors = []
    if(!isObject(document)) return makeValidationResult(['document must be an object'])
    if(document.schema !== EVENT_JOURNAL_SCHEMA) errors.push('schema is invalid')
    if(document.schema_version !== SCHEMA_VERSION) errors.push('schema_version is invalid')
    if(!document.document_id) errors.push('document_id is required')
    errors.push(...validatePublisher(document.publisher, 'publisher'))
    if(!Array.isArray(document.events)) errors.push('events must be an array')
    else {
        document.events.forEach((event, index) => {
            errors.push(...validateSharedModerationEvent(event, index))
        })
    }
    return makeValidationResult(errors)
}

function findForbiddenRoamingFields(value, path = '') {
    const found = []
    if(Array.isArray(value)) {
        value.forEach((entry, index) => {
            found.push(...findForbiddenRoamingFields(entry, `${path}[${index}]`))
        })
        return found
    }
    if(!isObject(value)) return found

    for(const [key, child] of Object.entries(value)) {
        const childPath = path ? `${path}.${key}` : key
        if(FORBIDDEN_ROAMING_KEYS.has(key)) found.push(childPath)
        found.push(...findForbiddenRoamingFields(child, childPath))
    }
    return found
}

function validateRoamingProfile(document = {}) {
    const errors = []
    if(!isObject(document)) return makeValidationResult(['document must be an object'])
    if(document.schema !== ROAMING_PROFILE_SCHEMA) errors.push('schema is invalid')
    if(document.schema_version !== SCHEMA_VERSION) errors.push('schema_version is invalid')
    if(!document.document_id) errors.push('document_id is required')
    errors.push(...validatePublisher(document.publisher, 'publisher'))
    const forbidden = findForbiddenRoamingFields(document)
    for(const path of forbidden) errors.push(`forbidden roaming field: ${path}`)
    return makeValidationResult(errors)
}

function renderMblockDocument(document = {}) {
    return [
        MBLOCK_BEGIN,
        stableStringify(document),
        MBLOCK_END
    ].join('\n')
}

function parseMblockBlocks(text = '') {
    const blocks = []
    const pattern = /MBLOCK:BEGIN\s+v=(\d+)\s*([\s\S]*?)\s*MBLOCK:END/g
    let match
    while((match = pattern.exec(`${text || ''}`))) {
        const version = Number.parseInt(match[1], 10)
        const raw = `${match[2] || ''}`.trim()
        let document = null
        let error = ''
        try {
            document = JSON.parse(raw)
        }
        catch(parseError) {
            error = parseError.message || String(parseError)
        }
        blocks.push({
            version,
            raw,
            ok: !!document && !error,
            error,
            document
        })
    }
    return blocks
}

function normalizeEventJournal(document = {}) {
    const validation = validateEventJournal(document)
    if(!validation.ok) {
        return {
            ok: false,
            errors: validation.errors,
            journal: null
        }
    }

    const seen = new Set()
    const duplicateEventIds = []
    const events = []
    for(const event of document.events || []) {
        if(seen.has(event.event_id)) {
            duplicateEventIds.push(event.event_id)
            continue
        }
        seen.add(event.event_id)
        const normalized = cloneJson(event)
        if(PROFILE_EVENT_TYPES.has(normalized.type)) {
            normalized.canonical_subject = normalizeProfileTransportSubject(normalized.subject)
        }
        if(normalized.type === EVENT_TYPES.SPACE_CLASSIFICATION_SET) {
            normalized.space = normalizeSpaceUrl(normalized.space)
            normalized.classification = normalizeClassification(normalized.classification)
        }
        events.push(normalized)
    }

    return {
        ok: true,
        errors: [],
        duplicateEventIds,
        journal: {
            ...cloneJson(document),
            events
        }
    }
}

function classifySourceRelationship(document = {}, localPublisher = {}) {
    const publisher = document?.publisher || {}
    const localQuora = `${localPublisher.quora_profile || ''}`.trim()
    const localDid = `${localPublisher.atproto_did || ''}`.trim()
    if(localQuora && publisher.quora_profile === localQuora) return 'self'
    if(localDid && publisher.atproto_did === localDid) return 'self'
    if(publisher.quora_profile || publisher.atproto_did) return 'external'
    return 'unknown'
}

function publisherIdentity(publisher = {}) {
    return `${publisher.quora_profile || publisher.atproto_did || 'unknown'}`.trim() || 'unknown'
}

function profileModerationInputKey(journal = {}, event = {}) {
    return [
        publisherIdentity(journal.publisher || {}),
        journal.document_id || 'unknown-document',
        event.event_id || 'unknown-event'
    ].join('|')
}

function collectProfileModerationInputs(journals = [], options = {}) {
    const dismissed = new Set(options.dismissedInputKeys || [])
    const inputs = []

    for(const journal of journals || []) {
        const normalized = normalizeEventJournal(journal)
        if(!normalized.ok) continue
        const relationship = classifySourceRelationship(normalized.journal, options.localPublisher || {})
        if(relationship !== 'external') continue

        for(const event of normalized.journal.events || []) {
            if(!PROFILE_EVENT_TYPES.has(event.type)) continue
            const key = profileModerationInputKey(normalized.journal, event)
            if(dismissed.has(key)) continue
            inputs.push({
                key,
                status: 'new',
                subject: event.canonical_subject,
                eventType: event.type,
                sourceRelationship: relationship,
                sourcePublisher: cloneJson(normalized.journal.publisher || {}),
                sourceDocumentId: normalized.journal.document_id,
                sourceEventId: event.event_id,
                occurredAt: event.occurred_at || ''
            })
        }
    }

    return inputs
}

function reduceImportInbox(state = {}, action = {}) {
    const byKey = new Map()
    for(const item of state.items || []) {
        if(item && item.key) byKey.set(item.key, cloneJson(item))
    }

    if(action.type === 'import') {
        for(const input of action.inputs || []) {
            if(!input?.key || byKey.has(input.key)) continue
            byKey.set(input.key, {
                ...cloneJson(input),
                status: input.status || 'new',
                importedAt: action.at || input.importedAt || ''
            })
        }
    }

    if(action.type === 'dismiss' || action.type === 'apply') {
        const keys = new Set(action.keys || (action.key ? [action.key] : []))
        for(const key of keys) {
            const item = byKey.get(key)
            if(!item) continue
            if(action.type === 'dismiss') {
                byKey.set(key, {
                    ...item,
                    status: 'dismissed',
                    dismissedAt: item.dismissedAt || action.at || ''
                })
            }
            else {
                byKey.set(key, {
                    ...item,
                    status: 'applied',
                    appliedAt: item.appliedAt || action.at || '',
                    appliedLocalEventId: item.appliedLocalEventId || action.localEventId || ''
                })
            }
        }
    }

    return {
        items: Array.from(byKey.values())
    }
}

function shouldExportPendingEvents(pendingCount = 0, options = {}) {
    const count = Number.parseInt(pendingCount, 10) || 0
    const threshold = Number.parseInt(options.minimumAutoExportEvents, 10) || 1
    if(options.manual === true) {
        return {
            shouldExport: count > 0,
            reason: count > 0 ? 'manual' : 'no-pending-events'
        }
    }
    if(count >= threshold) {
        return {
            shouldExport: true,
            reason: 'threshold-met'
        }
    }
    return {
        shouldExport: false,
        reason: 'skipped-low-volume'
    }
}

function reduceExportState(events = [], action = {}) {
    const now = action.at || ''
    const ids = new Set(action.eventIds || action.proof?.verified_event_ids || [])
    return (events || []).map(event => {
        if(!ids.has(event.event_id)) return event
        if(action.type === 'attempt') {
            return {
                ...event,
                export_status: 'attempting',
                export_attempt_id: action.attemptId || '',
                export_started_at: now
            }
        }
        if(action.type === 'failure') {
            return {
                ...event,
                export_status: 'pending',
                export_error: action.error || 'export failed',
                export_attempt_id: action.attemptId || event.export_attempt_id || ''
            }
        }
        if(action.type === 'proof') {
            return {
                ...event,
                export_status: 'exported',
                export_document_id: action.proof?.document_id || '',
                export_post_url: action.proof?.post_url || '',
                export_verified_at: now
            }
        }
        return event
    })
}

function verifyPostedProof(document = {}, proof = {}) {
    const errors = []
    if(!proof || typeof proof !== 'object') return makeValidationResult(['proof must be an object'])
    if(proof.document_id !== document.document_id) errors.push('proof document_id mismatch')
    const expectedIds = new Set((document.events || []).map(event => event.event_id))
    const verifiedIds = new Set(proof.verified_event_ids || [])
    for(const id of expectedIds) {
        if(!verifiedIds.has(id)) errors.push(`proof missing event id: ${id}`)
    }
    return makeValidationResult(errors)
}

function collectSpaceRecommendations(journals = [], options = {}) {
    const dismissed = new Set(options.dismissedRecommendationKeys || [])
    const recommendations = new Map()

    for(const journal of journals || []) {
        const normalized = normalizeEventJournal(journal)
        if(!normalized.ok) continue
        const relationship = classifySourceRelationship(normalized.journal, options.localPublisher || {})
        if(relationship !== 'external') continue

        for(const event of normalized.journal.events || []) {
            if(event.type !== EVENT_TYPES.SPACE_CLASSIFICATION_SET) continue
            const key = [
                event.space,
                event.classification.category,
                event.classification.mode,
                normalized.journal.publisher?.quora_profile || normalized.journal.publisher?.atproto_did || 'unknown'
            ].join('|')
            if(dismissed.has(key)) continue

            const existing = recommendations.get(key) || {
                key,
                space: event.space,
                classification: cloneJson(event.classification),
                sourceCount: 0,
                sourceDocuments: [],
                firstSeenAt: event.occurred_at || '',
                lastSeenAt: event.occurred_at || ''
            }
            existing.sourceCount += 1
            existing.sourceDocuments.push(normalized.journal.document_id)
            if(event.occurred_at && (!existing.firstSeenAt || event.occurred_at < existing.firstSeenAt)) {
                existing.firstSeenAt = event.occurred_at
            }
            if(event.occurred_at && (!existing.lastSeenAt || event.occurred_at > existing.lastSeenAt)) {
                existing.lastSeenAt = event.occurred_at
            }
            recommendations.set(key, existing)
        }
    }

    return Array.from(recommendations.values())
}

function reduceSpaceRecommendationInbox(state = {}, action = {}) {
    const byKey = new Map()
    for(const item of state.items || []) {
        if(item && item.key) byKey.set(item.key, cloneJson(item))
    }

    if(action.type === 'import') {
        for(const recommendation of action.recommendations || []) {
            if(!recommendation?.key || byKey.has(recommendation.key)) continue
            byKey.set(recommendation.key, {
                ...cloneJson(recommendation),
                status: recommendation.status || 'new',
                importedAt: action.at || recommendation.importedAt || ''
            })
        }
    }

    if(action.type === 'dismiss' || action.type === 'apply') {
        const keys = new Set(action.keys || (action.key ? [action.key] : []))
        for(const key of keys) {
            const item = byKey.get(key)
            if(!item) continue
            if(action.type === 'dismiss') {
                byKey.set(key, {
                    ...item,
                    status: 'dismissed',
                    dismissedAt: item.dismissedAt || action.at || ''
                })
            }
            else {
                byKey.set(key, {
                    ...item,
                    status: 'applied',
                    appliedAt: item.appliedAt || action.at || '',
                    appliedLocalEventId: item.appliedLocalEventId || action.localEventId || ''
                })
            }
        }
    }

    return {
        items: Array.from(byKey.values())
    }
}

function makeLocalSpaceClassificationEvent(recommendation = {}, options = {}) {
    const classification = normalizeClassification(recommendation.classification)
    const space = normalizeSpaceUrl(recommendation.space)
    if(!recommendation.key || !space || !classification) {
        return {
            ok: false,
            errors: ['recommendation must include key, space, and classification'],
            event: null
        }
    }

    return {
        ok: true,
        errors: [],
        event: {
            event_id: options.eventId || `local-space-classification:${recommendation.key}`,
            type: EVENT_TYPES.SPACE_CLASSIFICATION_SET,
            space,
            classification,
            occurred_at: options.at || '',
            accepted_recommendation_key: recommendation.key,
            accepted_source_documents: cloneJson(recommendation.sourceDocuments || [])
        }
    }
}

module.exports = {
    EVENT_JOURNAL_SCHEMA,
    EVENT_TYPES,
    FORBIDDEN_ROAMING_KEYS,
    MBLOCK_BEGIN,
    MBLOCK_END,
    POLICY_ACTIONS,
    ROAMING_PROFILE_SCHEMA,
    SCHEMA_VERSION,
    classifySourceRelationship,
    collectProfileModerationInputs,
    collectSpaceRecommendations,
    findForbiddenRoamingFields,
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
    stableStringify,
    validateEventJournal,
    validateRoamingProfile,
    validateSharedModerationEvent,
    verifyPostedProof
}
