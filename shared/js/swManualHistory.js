// Recent History is the completed-work log. A block or unblock made on a profile page (the extension's own Mute Block and Unblock
// Unmute buttons) is written to that log as a completed row, shaped like an archived row:
//   - a manual block is a succeeded row with outcome 'blocked' and origin 'manual';
//   - a manual unblock (a pardon) is a succeeded row with the unblock-unmute action kind and outcome 'unblocked'.
// An archived space nuke is already a completed row, and a nuke that ended in an error is a failed row with its error text.
//
// The key is 'history:<time>:<profile>', so a block and the pardon that follows it are two rows, and both show in the history.

const MANUAL_HISTORY_KEY_PREFIX = 'history:'
const MANUAL_BLOCK_ACTION_KIND = 'mute-block'
// The same action kind as UNBLOCK_UNMUTE_ACTION_KIND (sw.js and content.js).
const PARDON_ACTION_KIND = 'unblock-unmute'
const MANUAL_ORIGIN = 'manual'

function manualHistoryRowKey(profileHref = '', at = 0) {
    return `${MANUAL_HISTORY_KEY_PREFIX}${at}:${profileHref}`
}

// The completed row for a manual block or pardon, or null when the action or the profile or the time is not valid.
function makeManualHistoryRow({kind = '', profileHref = '', at = 0} = {}) {
    if (!profileHref || !Number.isFinite(at) || at <= 0) return null
    const isPardon = kind === 'pardon'
    if (!isPardon && kind !== 'block') return null
    return {
        targetProfileHref: profileHref,
        requestedUrl: profileHref,
        coordinatorKey: manualHistoryRowKey(profileHref, at),
        status: 'succeeded',
        outcome: isPardon ? 'unblocked' : 'blocked',
        actionKind: isPardon ? PARDON_ACTION_KIND : MANUAL_BLOCK_ACTION_KIND,
        origin: MANUAL_ORIGIN,
        error: '',
        terminalAt: at,
        updatedAt: at
    }
}

module.exports = {
    makeManualHistoryRow,
    manualHistoryRowKey,
    MANUAL_HISTORY_KEY_PREFIX,
    MANUAL_BLOCK_ACTION_KIND,
    PARDON_ACTION_KIND,
    MANUAL_ORIGIN
}
