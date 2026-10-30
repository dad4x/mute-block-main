// The status and label text the space page and the profile search page both show (27 Oct). Each page keeps its own state and decides when a
// status is shown (the presence rules stay on the page); this file only builds the words, so the two pages cannot word the same state
// differently. The DOM work (the elements, the classes and the button calls) stays in content.js.
//
// The toolbar status beside the batch button is built by formatNukingStatus, in this order:
//   "Queueing... N"   the profiles of a batch whose enqueue is still in flight (the search page passes its count; the space page passes none)
//   "Nuking... N left" or "Nuking..."   the queue's work (the count is left to nuke)
//   "Nuking Paused N left" or "Nuking Paused" in place of the Nuking part when the queue is paused (both pages pass the stored pause flag, 28 Oct).
// The parts are joined with " · ".

'use strict'

const NOTHING_QUEUED_LABEL = 'Nothing queued'
const NUKED_LABEL = 'Nuked'

function countOf(value) {
    return Math.max(0, Math.floor(Number(value) || 0))
}

// The batch button while the enqueue is in flight: "Queueing..." or "Queueing... R of T", R being what is still to queue of the T items.
function formatQueueingLabel(remaining = 0, totalItems = 0) {
    const left = countOf(remaining)
    return left > 0 ? `Queueing... ${left} of ${countOf(totalItems)}` : 'Queueing...'
}

// The queue's work for this page, with the count still to nuke when there is one. When the queue is paused the same label reads "Nuking Paused"
// (28 Oct), so the Nuking drop-down and the toolbar status share this one text.
function formatNukingLabel(left = 0, paused = false) {
    const remaining = countOf(left)
    const base = paused ? 'Nuking Paused' : 'Nuking...'
    return remaining > 0 ? `${base} ${remaining} left` : base
}

// The state text of one profile row (the search page's row button). The row names the state; the button sets the look.
function formatProfileRowState(state = '') {
    if(state === 'queueing') return 'Queueing...'
    if(state === 'nuking') return 'Nuking...'
    if(state === 'nuked') return NUKED_LABEL
    return ''
}

// The toolbar status text. Empty when no part applies, so the page removes its status element. A paused queue reads "Nuking Paused" even
// with no work for this page.
function formatNukingStatus({queueing = 0, nuking = false, nukingLeft = 0, paused = false} = {}) {
    const parts = []
    if(countOf(queueing) > 0) parts.push(`Queueing... ${countOf(queueing)}`)
    if(paused || nuking) parts.push(formatNukingLabel(nukingLeft, paused))
    return parts.join(' · ')
}

// The one presence rule both toolbars call (28 Oct). Each page passes its own facts: queueing is the profiles of its in-flight batch (not
// counted in left), left is the profiles still to nuke (never counting the in-flight ones), workActive is whether the page's queue work is
// running. The Nuking part shows while work is active, even with 0 left; the status is hidden only when nothing is active and nothing is paused.
function formatToolbarNukingStatus({queueing = 0, left = 0, workActive = false, paused = false} = {}) {
    const nukingLeft = countOf(left)
    return formatNukingStatus({
        queueing,
        nuking: nukingLeft > 0,
        nukingLeft,
        paused: !!paused
    })
}

module.exports = {
    NOTHING_QUEUED_LABEL,
    NUKED_LABEL,
    formatQueueingLabel,
    formatNukingLabel,
    formatProfileRowState,
    formatNukingStatus,
    formatToolbarNukingStatus
}
