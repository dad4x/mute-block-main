// What a queued profile resolution is looking for (30 Oct). The queue item says it, and the worker window reads the page to match.
//   'poster'          the poster of the thing being chased: the original poster of a question, or the header poster of a post
//   'named-profiles'  the profile a post names in its own text (one profile per item)
// Items without a subject keep the behavior they had before this field existed.
// Only the values are defined here. Copying the field through the queue is done where the queue copies its other resolution fields.

'use strict'

const RESOLUTION_SUBJECT_POSTER = 'poster'
const RESOLUTION_SUBJECT_NAMED_PROFILES = 'named-profiles'

function normalizeResolutionSubject(value = '') {
    const subject = `${value || ''}`.trim()
    return subject === RESOLUTION_SUBJECT_POSTER || subject === RESOLUTION_SUBJECT_NAMED_PROFILES ? subject : ''
}

module.exports = {
    RESOLUTION_SUBJECT_POSTER,
    RESOLUTION_SUBJECT_NAMED_PROFILES,
    normalizeResolutionSubject
}
