// The Stop collecting control of a collect (7 Nov). The space page and the search page each have one: a button that shows only while its
// collect runs, with the Stop collecting label read from the run's counters once per tick, and a click that asks the run to stop. This
// module holds the one copy of that behaviour. Each page passes in its own button, state and click handler.
const {formatCollectStopLabel} = require('./candidateCollect')

function createCollectStopControl({
    buttonSelector,
    createButton,
    clickKey,
    tickMs,
    isCollecting,
    readProgress,
    timeLimitSeconds,
    requestStop,
    bindClick,
    getDocument,
    setIntervalFn,
    clearIntervalFn
}) {
    let timer = 0

    // Written only when the text changes, so the page's observers are not woken for the same label.
    function refreshLabel() {
        const stopButton = getDocument().querySelector(buttonSelector)
        if(!stopButton || !isCollecting()) return
        const progress = readProgress()
        const label = formatCollectStopLabel({
            collected: progress.collected,
            target: progress.target,
            passes: progress.passes,
            elapsedMs: Date.now() - progress.startedAt,
            timeLimitMs: timeLimitSeconds() * 1000
        })
        if(stopButton.textContent !== label) stopButton.textContent = label
    }

    function sync() {
        // The label is re-read once per tick while a run is active (owner, 27 Oct). The tick ends with the run.
        if(isCollecting() && !timer) timer = setIntervalFn(refreshLabel, tickMs)
        if(!isCollecting() && timer) {
            clearIntervalFn(timer)
            timer = 0
        }
        let stopButton = getDocument().querySelector(buttonSelector)
        if(!stopButton) {
            if(!isCollecting()) return
            stopButton = createButton()
            getDocument().body?.appendChild(stopButton)
        }
        const button = bindClick(stopButton, clickKey, () => requestStop())
        if(button) button.hidden = !isCollecting()
        refreshLabel()
    }

    return {sync, refreshLabel}
}

module.exports = {createCollectStopControl}
