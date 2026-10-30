// The Nuking drop-down's pure parts (shared/js/nukingControl.js, 28 Oct): the paused and running labels, which item is offered in each state,
// the hover help on the drop-down and its items, and the messages it sends. The messages are checked against the dashboard's Pause Current
// Work handler in shared/js/coordinator.js, by action name and payload keys. The DOM placement is pinned in test/p1-contract.test.js.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
    PAUSE_COORDINATOR_NUKES_ACTION,
    RESUME_PAUSED_COORDINATOR_NUKES_ACTION,
    NUKING_CONTROL_TOGGLE_HELP,
    nukingControlMessage,
    nukingControlLabel,
    nukingStatusShowsControl,
    nukingControlView
} = require('../shared/js/nukingControl')
const {MUTE_BLOCK_HELP_PREFIX, setMuteBlockHelp} = require('../shared/js/muteBlockHelp')

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

const repoRoot = path.resolve(__dirname, '..')
const dashboard = fs.readFileSync(path.join(repoRoot, 'shared/js/coordinator.js'), 'utf8')

// The body of the dashboard's Pause Current Work handler, which picks the message the button sends.
function dashboardToggleBody() {
    const start = dashboard.indexOf('async function toggleCurrentWorkPause()')
    assert.ok(start >= 0, 'coordinator.js has toggleCurrentWorkPause')
    const end = dashboard.indexOf('\n}\n', start)
    return dashboard.slice(start, end)
}

test('the drop-down label reads Nuking Paused when paused and Nuking... when running', () => {
    assert.equal(nukingControlLabel(true), 'Nuking Paused')
    assert.equal(nukingControlLabel(false), 'Nuking...')
    assert.equal(nukingControlLabel(true, 3), 'Nuking Paused 3 left')
    assert.equal(nukingControlLabel(false, 3), 'Nuking... 3 left')
    assert.equal(nukingControlView(true).toggleLabel, 'Nuking Paused')
    assert.equal(nukingControlView(false).toggleLabel, 'Nuking...')
})

test('the drop-down offers Pause while running and Resume while paused', () => {
    const running = nukingControlView(false)
    const paused = nukingControlView(true)
    assert.deepEqual(running.items.map(item => item.label), ['Pause Current Work', 'Resume Current Work'])
    assert.equal(running.items.find(item => item.id === 'pause').enabled, true)
    assert.equal(running.items.find(item => item.id === 'resume').enabled, false)
    assert.equal(paused.items.find(item => item.id === 'resume').enabled, true)
    assert.equal(paused.items.find(item => item.id === 'pause').enabled, false)
})

// A stand-in for a DOM element: setMuteBlockHelp sets title and aria-label on it.
function fakeElement() {
    const attributes = {}
    return {
        title: '',
        attributes,
        setAttribute(name, value) {
            attributes[name] = value
        },
        getAttribute(name) {
            return attributes[name]
        }
    }
}

test('the drop-down and each of its items have hover help that starts with the Mute Block prefix', () => {
    assert.equal(MUTE_BLOCK_HELP_PREFIX, 'Mute Block extension: ')
    for (const paused of [false, true]) {
        const view = nukingControlView(paused)
        // The drop-down's own help is the owner's text, and the page sets it through setMuteBlockHelp.
        const toggle = fakeElement()
        setMuteBlockHelp(toggle, view.toggleHelpText)
        assert.equal(toggle.title, 'Mute Block extension: Pause or resume all Current Work. This pauses the whole queue, not only this page.')
        assert.equal(toggle.title, `${MUTE_BLOCK_HELP_PREFIX}${NUKING_CONTROL_TOGGLE_HELP}`)
        assert.equal(toggle.getAttribute('aria-label'), toggle.title)
        for (const item of view.items) {
            const element = fakeElement()
            setMuteBlockHelp(element, item.helpText)
            assert.ok(element.title.startsWith('Mute Block extension: '), `${item.id} help starts with the prefix`)
            assert.equal(element.getAttribute('aria-label'), element.title)
            assert.ok(element.title.includes('not only this page'), `${item.id} help says it covers all Current Work, not only this page`)
        }
    }
})

test('the drop-down sends the same action name and payload the dashboard sends', () => {
    const body = dashboardToggleBody()
    // The dashboard's pair: pause sends only the action; resume sends the action and debugLimit.
    assert.match(body, /\{action: 'resume-paused-coordinator-nukes', debugLimit: readDebugResumeLimitFromControls\(\)\}/)
    assert.match(body, /\{action: 'pause-coordinator-nukes'\}/)

    assert.equal(PAUSE_COORDINATOR_NUKES_ACTION, 'pause-coordinator-nukes')
    assert.equal(RESUME_PAUSED_COORDINATOR_NUKES_ACTION, 'resume-paused-coordinator-nukes')

    const pauseMessage = nukingControlMessage(false)
    const resumeMessage = nukingControlMessage(true)
    assert.deepEqual(Object.keys(pauseMessage), ['action'])
    assert.deepEqual(Object.keys(resumeMessage).sort(), ['action', 'debugLimit'])
    assert.equal(pauseMessage.action, 'pause-coordinator-nukes')
    assert.equal(resumeMessage.action, 'resume-paused-coordinator-nukes')
    assert.equal(resumeMessage.debugLimit, null)

    // The items carry the same messages, in the state each is offered.
    const running = nukingControlView(false)
    const paused = nukingControlView(true)
    assert.deepEqual(running.items.find(item => item.id === 'pause').message, pauseMessage)
    assert.deepEqual(paused.items.find(item => item.id === 'resume').message, resumeMessage)
})

test('the worker actions the drop-down names are the ones the worker handles', () => {
    const bootstrap = fs.readFileSync(path.join(repoRoot, 'shared/js/swBootstrap.js'), 'utf8')
    assert.ok(bootstrap.includes("request.action === 'pause-coordinator-nukes'"))
    assert.ok(bootstrap.includes("request.action === 'resume-paused-coordinator-nukes'"))
})

test('nukingStatusShowsControl is true only for a nuking or paused nuking text', () => {
    assert.equal(nukingStatusShowsControl('Nuking... 2 left'), true)
    assert.equal(nukingStatusShowsControl('Nuking Paused'), true)
    assert.equal(nukingStatusShowsControl('Queueing... 3 · Nuking... 2 left'), true)
    assert.equal(nukingStatusShowsControl('Queueing... 3'), false)
    assert.equal(nukingStatusShowsControl(''), false)
    assert.equal(nukingStatusShowsControl(undefined), false)
})

console.log('nukingControl: all tests passed')
