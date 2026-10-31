// The Nuking drop-down (owner, 28 Oct): a small menu beside each "Nuking..." control on the space page and the profile search page, with Pause
// and Resume, so the queue can be paused from the page instead of the dashboard. It pauses the whole queue (the dashboard's Pause Current Work),
// not only the page's own work.
//
// This file holds the pure parts: the messages, the items and their help, and the label. The DOM work (the elements, the clicks and the
// placement) stays in content.js, which builds every drop-down with nukingControlView. The messages are the ones the dashboard sends from
// its Pause Current Work button (toggleCurrentWorkPause in shared/js/coordinator.js). No new worker action and no storage write is added here.

'use strict'

const {formatNukingStatus, formatToolbarNukingStatus} = require('./candidateStatus')

const PAUSE_COORDINATOR_NUKES_ACTION = 'pause-coordinator-nukes'
const RESUME_PAUSED_COORDINATOR_NUKES_ACTION = 'resume-paused-coordinator-nukes'

const NUKING_CONTROL_TOGGLE_HELP = 'Pause or resume all Current Work. This pauses the whole queue, not only this page.'
const NUKING_PAUSE_ITEM_HELP = 'Pause Current Work. The pause covers all Current Work, not only this page.'
const NUKING_RESUME_ITEM_HELP = 'Resume Current Work. The resume covers all paused Current Work, not only this page.'

// The message the dashboard sends for the current state: Pause when the queue runs, Resume (with the same debugLimit field, null here, since
// the page has no dev-mode limit controls) when it is paused. The worker reads a missing limit as none.
function nukingControlMessage(paused = false) {
    return paused
        ? {action: RESUME_PAUSED_COORDINATOR_NUKES_ACTION, debugLimit: null}
        : {action: PAUSE_COORDINATOR_NUKES_ACTION}
}

// The drop-down's text: the same words the toolbar status uses ("Nuking..." or "Nuking Paused", with the count left when there is one).
function nukingControlLabel(paused = false, left = 0) {
    return formatNukingStatus({nuking: true, nukingLeft: left, paused: !!paused})
}

// Whether a status text shows nuking work or a paused nuking queue. The drop-down sits beside a status only when it does.
function nukingStatusShowsControl(text = '') {
    return /\bNuking\b/.test(`${text || ''}`)
}

// The space page's toolbar beside the batch button (owner, 30 Oct): the drop-down carries the Nuking words and count, so the status text keeps only
// the queueing count. The drop-down shows whenever nuking work is left or the queue is paused, the same rule as before.
function spaceFeedNukingToolbar({queueing = 0, left = 0, paused = false} = {}) {
    return {
        statusText: formatNukingStatus({queueing}),
        showsControl: !!formatToolbarNukingStatus({left, paused: !!paused})
    }
}

// The drop-down for the current state. Both items are listed; the one that does not apply is disabled, so the state is always visible.
// Each item carries the message it sends and its raw hover help; the page passes that to setMuteBlockHelp, which adds the prefix.
function nukingControlView(paused = false, left = 0) {
    const isPaused = !!paused
    return {
        toggleLabel: nukingControlLabel(isPaused, left),
        toggleHelpText: NUKING_CONTROL_TOGGLE_HELP,
        items: [
            {
                id: 'pause',
                label: 'Pause Current Work',
                enabled: !isPaused,
                helpText: NUKING_PAUSE_ITEM_HELP,
                message: nukingControlMessage(false)
            },
            {
                id: 'resume',
                label: 'Resume Current Work',
                enabled: isPaused,
                helpText: NUKING_RESUME_ITEM_HELP,
                message: nukingControlMessage(true)
            }
        ]
    }
}

module.exports = {
    PAUSE_COORDINATOR_NUKES_ACTION,
    RESUME_PAUSED_COORDINATOR_NUKES_ACTION,
    NUKING_CONTROL_TOGGLE_HELP,
    NUKING_PAUSE_ITEM_HELP,
    NUKING_RESUME_ITEM_HELP,
    nukingControlMessage,
    nukingControlLabel,
    nukingStatusShowsControl,
    nukingControlView,
    spaceFeedNukingToolbar
}
