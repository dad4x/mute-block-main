// The bottom progress bar, the one bar every page that has one uses (owner, 6 Nov): the dashboard, the History page and the Preferences
// page. queueProgressBar.js builds it; this file adds the Pause and Resume control and the rule for when it shows. A page feeds the bar
// numbers and says whether the queue has work left. The bar knows nothing about the queue itself.
//
// The numbers come from one of two places. The dashboard counts the rows it renders. The History and Preferences pages have no queue
// view, so they ask the worker for the queue-bar summary (counts only) and read the paused flag from storage.

const {createQueueProgressBar} = require('./queueProgressBar')
const {setMuteBlockHelp} = require('./muteBlockHelp')
const {COORDINATOR_PAUSED_KEY} = require('./storageKeys')
const {namespaceArea} = require('./storageNamespace')
const {QUEUE_BAR_GET_ACTION, getQueueBarDisplay} = require('./swQueueBarSummary')

const PAUSE_BUTTON_HELP = 'Mute Block extension: Pause the queue, or resume it'

// The Pause/Resume label. A request in flight shows its own words and the button waits for it.
function pauseButtonLabel(paused, pending) {
    if(pending === 'pause') return 'Pausing...'
    if(pending === 'resume') return 'Resuming...'
    return paused ? 'Resume' : 'Pause'
}

// Builds the bar on the current page and returns its handle. The logo is a link to the Mute Block site (queueProgressBar.js); `onPauseClick`
// runs when Pause or Resume is pressed. The bar stays on its page whether or not the queue has work (owner, 7 Nov).
function createQueueBottomBar({onPauseClick = null} = {}) {
    const pauseButton = document.createElement('button')
    pauseButton.type = 'button'
    pauseButton.className = 'clear-button pause-toggle'
    pauseButton.id = 'queueBottomBarPauseResume'
    setMuteBlockHelp(pauseButton, PAUSE_BUTTON_HELP)
    pauseButton.addEventListener('click', () => {
        if(typeof onPauseClick === 'function') void onPauseClick()
    })
    const progress = createQueueProgressBar({
        barId: 'queueBottomBar',
        iconSrc: 'icons/32.png',
        interactive: true,
        controls: [pauseButton]
    })
    document.body.appendChild(progress.bar)

    let paused = false
    let pending = ''
    function paint() {
        pauseButton.textContent = pauseButtonLabel(paused, pending)
        pauseButton.disabled = pending !== ''
    }

    return {
        bar: progress.bar,
        // The page's numbers.
        update({percent = 0, label = '', paused: isPaused = false}) {
            progress.setProgress(percent, label)
            paused = isPaused
            paint()
        },
        // The Pause or Resume request in flight: 'pause', 'resume', or '' when none is.
        setPending(value = '') {
            pending = value
            paint()
        }
    }
}

// The stored paused flag. Not queue data, so a page may read it.
async function readStoredQueuePaused(browserApi) {
    const stored = await namespaceArea(browserApi.storage.local).get({[COORDINATOR_PAUSED_KEY]: false}).catch(() => ({}))
    return !!stored[COORDINATOR_PAUSED_KEY]
}

// The bar's numbers from the worker's queue-bar summary (counts only) and the stored paused flag. For a page with no queue view.
async function refreshQueueBarFromSummary(bar, browserApi) {
    const paused = await readStoredQueuePaused(browserApi)
    const reply = await browserApi.runtime.sendMessage({action: QUEUE_BAR_GET_ACTION}).catch(() => null)
    const display = getQueueBarDisplay(reply?.summary || null, paused)
    bar.update({
        percent: display.percent,
        label: `${display.terminal} / ${display.total}`,
        paused
    })
    return {paused}
}

// The one pause request the bar sends. A resume carries the dev-mode limit when there is one.
async function sendQueuePauseRequest(browserApi, paused, debugLimit = null) {
    const request = paused
        ? {action: 'resume-paused-coordinator-nukes', debugLimit}
        : {action: 'pause-coordinator-nukes'}
    return browserApi.runtime.sendMessage(request).catch(error => ({error: error?.message || `${error || ''}`}))
}

module.exports = {
    createQueueBottomBar,
    pauseButtonLabel,
    readStoredQueuePaused,
    refreshQueueBarFromSummary,
    sendQueuePauseRequest
}
