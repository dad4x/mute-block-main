// Button presses (owner, 6 Nov). Every press on an extension control is recorded in the flight recorder, and a press flashes the
// button once. Nuke 'Em keeps its own double flash, so it is not given this one. The listener reads the press and changes nothing else.

const BUTTON_PRESS_FLASH_CLASS = 'mb-button-press-flash'
// Nuke 'Em on a profile or Quora page, and on a space page. Both have their own flash, so this single one is left off them.
const NUKE_EM_BUTTON_CLASSES = ['mb-ext_nuke-profiles-btn', 'mb-ext_space-feed-nuke-btn']

// The name a press is recorded under: the button's id, else its label, else its class.
function buttonPressLabel(button) {
    const text = `${button?.textContent || ''}`.replace(/\s+/g, ' ').trim()
    const label = button?.id || button?.getAttribute?.('aria-label') || text || button?.className || 'button'
    return `${label}`.slice(0, 60)
}

function isNukeEmButton(button) {
    return NUKE_EM_BUTTON_CLASSES.some(name => button?.classList?.contains(name))
}

function flashButtonPress(button) {
    if(!button || isNukeEmButton(button)) return
    // A button that already runs its own flash (the clear and pause buttons) keeps that one.
    if(`${button.className || ''}`.includes('--flash')) return
    button.classList.remove(BUTTON_PRESS_FLASH_CLASS)
    void button.offsetWidth
    button.classList.add(BUTTON_PRESS_FLASH_CLASS)
    // The class comes off when the animation ends, so the script and the stylesheet share one duration (the token).
    button.addEventListener('animationend', () => button.classList.remove(BUTTON_PRESS_FLASH_CLASS), {once: true})
}

// One capture-phase click listener on the page. `selector` limits which buttons count (a Quora page passes the extension's own
// buttons only, so the site's buttons are not touched). `report(label)` records the press.
function installButtonPressListener({selector = 'button', report = null} = {}) {
    document.addEventListener('click', event => {
        const button = event.target?.closest?.(selector)
        if(!button) return
        if(typeof report === 'function') report(buttonPressLabel(button))
        flashButtonPress(button)
    }, true)
}

module.exports = {
    BUTTON_PRESS_FLASH_CLASS,
    buttonPressLabel,
    flashButtonPress,
    installButtonPressListener,
    isNukeEmButton
}
