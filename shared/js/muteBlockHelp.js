// Hover help for the buttons this extension shows (25 Oct). Every hover text starts with the same words, so a user can tell which buttons
// are ours. The live CDP click tool matches on that prefix too (tools/cdp/click-profile-extension-action.js).
const MUTE_BLOCK_HELP_PREFIX = 'Mute Block extension: '

function muteBlockHelpText(helpText = '') {
    return `${MUTE_BLOCK_HELP_PREFIX}${helpText}`
}

// Sets the hover text (title) and the accessible name (aria-label) of an element to the prefixed help.
function setMuteBlockHelp(element, helpText = '') {
    if(!element) return
    const text = muteBlockHelpText(helpText)
    element.title = text
    element.setAttribute('aria-label', text)
}

module.exports = {
    MUTE_BLOCK_HELP_PREFIX,
    muteBlockHelpText,
    setMuteBlockHelp
}
