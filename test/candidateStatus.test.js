// The status and label text both batch pages share (shared/js/candidateStatus.js). The space page and the profile search page each map their own
// counts onto formatNukingStatus, so these tests pin the one function both use: the same inputs give the same text, Queueing comes before
// Nuking, an empty state gives an empty string, and a paused queue reads Nuking Paused. The page wiring is pinned in test/p1-contract.test.js.
const assert = require('node:assert/strict')

const {
    NOTHING_QUEUED_LABEL,
    NUKED_LABEL,
    formatQueueingLabel,
    formatNukingLabel,
    formatProfileRowState,
    formatNukingStatus,
    formatToolbarNukingStatus
} = require('../shared/js/candidateStatus')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

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

// The inputs each page builds from its own counts, as content.js builds them: the space page from its model, the search page from its toolbar.
// Both pages read the paused flag from the stored pause (nukingQueuePaused in content.js, 28 Oct), passed here as paused.
function spacePageStatus(model) {
    return formatNukingStatus({
        nuking: !!model.activeWork,
        nukingLeft: model.pendingProfileCount || 0,
        paused: !!model.paused
    })
}

function searchPageStatus({remaining, queueing, paused = false}) {
    return formatNukingStatus({queueing, nuking: remaining > 0, nukingLeft: remaining, paused: !!paused})
}

test('formatNukingStatus gives the same text for the same inputs, whichever page asks', () => {
    // The same state on both pages: work left to nuke, and nothing in flight.
    assert.equal(spacePageStatus({activeWork: true, pendingProfileCount: 2}), searchPageStatus({remaining: 2, queueing: 0}))
    assert.equal(spacePageStatus({activeWork: true, pendingProfileCount: 2}), 'Nuking... 2 left')
    // The same state with a batch in flight on the search page.
    assert.equal(searchPageStatus({remaining: 4, queueing: 3}), 'Queueing... 3 · Nuking... 4 left')
    // Nothing to show on either page.
    assert.equal(spacePageStatus({activeWork: false, pendingProfileCount: 0}), '')
    assert.equal(searchPageStatus({remaining: 0, queueing: 0}), '')
    // Same inputs, same output, every time.
    const inputs = {queueing: 2, nuking: true, nukingLeft: 5, paused: true}
    assert.equal(formatNukingStatus(inputs), formatNukingStatus({...inputs}))
})

test('formatNukingStatus puts Queueing before Nuking', () => {
    const text = formatNukingStatus({queueing: 3, nuking: true, nukingLeft: 2})
    assert.equal(text, 'Queueing... 3 · Nuking... 2 left')
    assert.ok(text.indexOf('Queueing...') < text.indexOf('Nuking...'))
    // Queueing alone, with nothing to nuke yet.
    assert.equal(formatNukingStatus({queueing: 3, nuking: false, nukingLeft: 0}), 'Queueing... 3')
})

test('formatNukingStatus gives an empty string for an empty state', () => {
    assert.equal(formatNukingStatus({}), '')
    assert.equal(formatNukingStatus({queueing: 0, nuking: false, nukingLeft: 0, paused: false}), '')
    // A count alone does not show the nuking part: the page must say the work is active.
    assert.equal(formatNukingStatus({nuking: false, nukingLeft: 5}), '')
    // Negative or missing counts count as none.
    assert.equal(formatNukingStatus({queueing: -2, nuking: false}), '')
})

// Changed 28 Oct: the paused state reads "Nuking Paused" in place of "Nuking..." (it was "Paused · Nuking..." before).
test('formatNukingStatus reads Nuking Paused in place of Nuking when the queue is paused', () => {
    assert.equal(formatNukingStatus({paused: true}), 'Nuking Paused')
    assert.equal(formatNukingStatus({paused: true, nuking: true, nukingLeft: 2}), 'Nuking Paused 2 left')
    assert.equal(formatNukingStatus({paused: true, nuking: true, nukingLeft: 0}), 'Nuking Paused')
    assert.equal(formatNukingStatus({paused: true, queueing: 1, nuking: true, nukingLeft: 2}), 'Queueing... 1 · Nuking Paused 2 left')
    // The paused text is the same whichever page computes it.
    assert.equal(spacePageStatus({activeWork: false, paused: true}), 'Nuking Paused')
    assert.equal(searchPageStatus({remaining: 2, queueing: 0, paused: true}), 'Nuking Paused 2 left')
    assert.equal(formatNukingStatus({nuking: true, nukingLeft: 2}), 'Nuking... 2 left')
})

test('the Queueing batch label reads Queueing... with the count still to queue', () => {
    assert.equal(formatQueueingLabel(), 'Queueing...')
    assert.equal(formatQueueingLabel(0, 5), 'Queueing...')
    assert.equal(formatQueueingLabel(2, 5), 'Queueing... 2 of 5')
    assert.equal(formatQueueingLabel(-1, 5), 'Queueing...')
})

test('the Nuking label reads Nuking... with the count left when there is one', () => {
    assert.equal(formatNukingLabel(), 'Nuking...')
    assert.equal(formatNukingLabel(0), 'Nuking...')
    assert.equal(formatNukingLabel(3), 'Nuking... 3 left')
})

test('the profile row states and the batch notice text come from one place', () => {
    assert.equal(formatProfileRowState('queueing'), 'Queueing...')
    assert.equal(formatProfileRowState('nuking'), 'Nuking...')
    assert.equal(formatProfileRowState('nuked'), 'Nuked')
    assert.equal(formatProfileRowState('other'), '')
    assert.equal(NUKED_LABEL, 'Nuked')
    assert.equal(NOTHING_QUEUED_LABEL, 'Nothing queued')
})

// 28 Oct: the one presence rule both toolbars call (formatToolbarNukingStatus). E1 to E3 are pinned here for both pages' inputs.
test('E1: a batch queueing shows Queueing M, and the Nuking count leaves those profiles out', () => {
    // The space page: 3 profiles in the in-flight batch, 2 more still to nuke (the caller passes the count without the 3).
    assert.equal(formatToolbarNukingStatus({queueing: 3, left: 2, workActive: true}), 'Queueing... 3 · Nuking... 2 left')
    // Queueing with nothing else to nuke: the Queueing part alone.
    assert.equal(formatToolbarNukingStatus({queueing: 3, left: 0, workActive: false}), 'Queueing... 3')
})

test('E3 (revised 28 Oct): with nothing left to nuke the Nuking part is not shown, even while work is active; the status hides when idle and not paused', () => {
    assert.equal(formatToolbarNukingStatus({left: 0, workActive: true}), '')
    assert.equal(formatToolbarNukingStatus({left: 0, workActive: false}), '')
    assert.equal(formatToolbarNukingStatus({}), '')
    assert.equal(formatToolbarNukingStatus({left: 4, workActive: false}), 'Nuking... 4 left')
})

test('E2: a paused queue shows Nuking Paused on both pages, with or without work', () => {
    assert.equal(formatToolbarNukingStatus({left: 0, workActive: false, paused: true}), 'Nuking Paused')
    assert.equal(formatToolbarNukingStatus({left: 2, workActive: false, paused: true}), 'Nuking Paused 2 left')
    assert.equal(formatToolbarNukingStatus({queueing: 1, left: 2, workActive: true, paused: true}), 'Queueing... 1 · Nuking Paused 2 left')
})

test('E4: the profile row button reads Nuking... with no count, on both pages', () => {
    assert.equal(formatProfileRowState('nuking'), 'Nuking...')
    assert.equal(formatProfileRowState('queueing'), 'Queueing...')
})

// 28 Oct: the search page's end-of-results wording is "end of search results" (the cause line label, read from content.js). The
// internal reason string 'end-of-results' is unchanged: it is an identifier in the flight recorder.
test('end of search results: the cause label and its reason map read the new wording', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'shared', 'js', 'content.js'), 'utf8')
    const start = source.indexOf('const PROFILE_SEARCH_CAUSE_LABELS = ')
    const end = source.indexOf('\n}', start) + 2
    assert.ok(start !== -1 && end > start)
    const labels = vm.runInNewContext(`(${source.slice(start + 'const PROFILE_SEARCH_CAUSE_LABELS = '.length, end).replace(/;\s*$/, '')})`)
    assert.equal(labels['end-of-results'], 'End of search results')
    assert.equal(labels['end-of-feed'], 'End of search results')
    assert.equal(Object.values(labels).some(label => /\bend of results\b/i.test(label) && !/search/i.test(label)), false)
})

console.log('candidateStatus: all tests passed')
