// The Stop collecting label, shared by the space page and the profile search page (owner, 27 Oct). While a collect run is active, the
// button reads "N / M Stop collecting · S · m:ss":
//   N     the profiles or posts collected in this run so far (since the press).
//   M     the target the run started with (the Collect N More count).
//   S     the passes made through the collect loop in this run.
//   m:ss  the time since the run started.
// The label never says "scrolls". The DOM work (the button, its timer and the loop's counters) stays in content.js.

'use strict'

// The button's text when no run is active. It is the same text the label carries, so the two pages cannot drift apart.
const STOP_COLLECT_LABEL_TEXT = 'Stop collecting'

function countOf(value) {
    return Math.max(0, Math.floor(Number(value) || 0))
}

// Minutes and zero-padded seconds: 0 is 0:00, 65000 is 1:05, 600000 is 10:00. Minutes are not capped.
function formatElapsed(ms) {
    const totalSeconds = Math.floor(Math.max(0, Number(ms) || 0) / 1000)
    return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`
}

function formatCollectStopLabel({collected = 0, target = 0, passes = 0, elapsedMs = 0} = {}) {
    return `${countOf(collected)} / ${countOf(target)} ${STOP_COLLECT_LABEL_TEXT} · ${countOf(passes)} · ${formatElapsed(elapsedMs)}`
}

// A pass made progress when the count grew, or the page scrolled further down, or the page got taller. Both collect pages use it on the
// snapshots their loop takes before the pass and after the read.
function collectPassMadeProgress(before, after) {
    return after.count > before.count || after.scrollY > before.scrollY || after.scrollHeight > before.scrollHeight
}

// The shared collect loop (27 Oct). The space page and the profile search page run the same skeleton: a pass, a wait, a read, and a stall
// clock. The loop owns only that skeleton. Each page supplies its actions and its own end and stall rules as callbacks, and keeps its outer
// code (the press animation, the first scroll, the stop return, the notice and the end event). The order below is the order both pages
// already ran, so moving the loop here changes no behaviour.
//
// One pass:
//   before = snapshot()          the page state before the pass
//   pass(before)                 the page's action. Returning 'end' (the page reached its end) or 'done' (the page is finished) stops the run
//                                here, before the wait. Any other return continues.
//   sleep(waitMs)
//   readProgress()               the read after the wait; the page updates its counters here
//   after = snapshot()
//   madeProgress(before, after)  true: the stall clock restarts and the next pass runs
//   otherwise the stall clock runs from the first silent pass:
//     endCheck(stalledMs)        true: the run ends as 'end'
//     stallTimeoutApplies() and stalledMs >= stallTimeoutMs: onStall(), and the run ends as 'stalled'
//
// The loop runs while isStopRequested() is false and isDone() is false. It returns 'end', 'done' or 'stalled' when a rule ends it, and null
// when the stop flag or isDone ends it. It keeps no state of its own; `now` is the clock and defaults to Date.now.
async function runCollectLoop({
    isStopRequested,
    isDone,
    snapshot,
    pass,
    sleep,
    waitMs,
    readProgress = () => {},
    madeProgress,
    endCheck = () => false,
    stallTimeoutMs,
    stallTimeoutApplies = () => true,
    onStall = () => {},
    now = () => Date.now()
}) {
    let stalledStartedAt = 0
    while(!isStopRequested() && !isDone()) {
        const before = snapshot()
        const passOutcome = await pass(before)
        if(passOutcome === 'end' || passOutcome === 'done') return passOutcome
        await sleep(waitMs)
        readProgress()
        const after = snapshot()
        if(madeProgress(before, after)) {
            stalledStartedAt = 0
            continue
        }
        stalledStartedAt = stalledStartedAt || now()
        const stalledMs = now() - stalledStartedAt
        if(endCheck(stalledMs)) return 'end'
        if(stallTimeoutApplies() && stalledMs >= stallTimeoutMs) {
            onStall()
            return 'stalled'
        }
    }
    return null
}

module.exports = {formatElapsed, formatCollectStopLabel, STOP_COLLECT_LABEL_TEXT, collectPassMadeProgress, runCollectLoop}
